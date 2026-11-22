package com.upicheckout;

import androidx.annotation.Nullable;

import java.lang.ref.WeakReference;

/**
 * The one payment that may be waiting for a result, without any Android or
 * React Native types, so that the sequences can be tested on a plain JVM
 * (android/jvm-test). {@code P} is the promise type. Every instance method
 * runs on the UI thread.
 */
final class PaymentState<P> {
  /** Runs {@code task} later on the UI thread; the returned action cancels it. */
  interface Scheduler {
    Runnable schedule(Runnable task, long delayMillis);
  }

  /** Called when a request is settled because no result can arrive any more. */
  interface NoResultHandler<P> {
    void onNoResult(P promise);
  }

  /** Why {@link #refusal} refuses to start a payment. */
  enum Refusal {
    SHUTTING_DOWN("ACTIVITY_UNAVAILABLE", "The React instance is shutting down."),
    IN_PROGRESS("IN_PROGRESS", "Another UPI payment is still waiting for its result."),
    NO_ACTIVITY("ACTIVITY_UNAVAILABLE", "There is no foreground activity to start the UPI app from."),
    NOT_RESUMED("ACTIVITY_UNAVAILABLE",
        "The app is not in the foreground. Start the payment while the user is looking at the app.");

    final String code;
    final String message;

    Refusal(String code, String message) {
      this.code = code;
      this.message = message;
    }
  }

  /** A settled result kept for {@code getLastResult()}. */
  static final class Record {
    /** {@code null} when no result arrived at all. */
    @Nullable final Integer resultCode;
    @Nullable final String response;
    @Nullable final String transactionRef;
    final long time;

    Record(@Nullable Integer resultCode, @Nullable String response, @Nullable String transactionRef, long time) {
      this.resultCode = resultCode;
      this.response = response;
      this.transactionRef = transactionRef;
      this.time = time;
    }
  }

  /**
   * How long to wait for a result after the activity that started the
   * payment resumes. Android delivers a pending activity result before
   * {@code onResume}, so a result that has not arrived by then normally never
   * will; the delay only leaves room for a late delivery.
   */
  static final long RESUME_GRACE_MILLIS = 1500;

  // Process-wide, so that a result that arrives after a JavaScript reload (a
  // new React instance and a new module) is still recorded with the
  // transactionRef of the request that launched it. Lost when the process dies.
  @Nullable private static volatile Record lastResult;
  @Nullable private static volatile String launchedTransactionRef;

  private final Scheduler scheduler;

  @Nullable private P pending;
  @Nullable private WeakReference<Object> launchActivity;
  @Nullable private Runnable cancelGrace;
  // Identifies the current request, so that a stale grace task does nothing.
  private long requestId;

  PaymentState(Scheduler scheduler) {
    this.scheduler = scheduler;
  }

  boolean isPending() {
    return pending != null;
  }

  /**
   * Why a payment cannot start now, or {@code null} when it can. A payment is
   * only started from a resumed activity: an activity in the background may
   * not be allowed to start another app, and then no result ever comes back.
   */
  @Nullable
  Refusal refusal(boolean invalidated, @Nullable Object activity, boolean activityFinishing, boolean hostResumed) {
    if (invalidated) return Refusal.SHUTTING_DOWN;
    if (pending != null) return Refusal.IN_PROGRESS;
    if (activity == null || activityFinishing) return Refusal.NO_ACTIVITY;
    if (!hostResumed) return Refusal.NOT_RESUMED;
    return null;
  }

  void begin(P promise, Object activity, @Nullable String transactionRef, long now) {
    cancelGrace();
    requestId++;
    pending = promise;
    launchActivity = new WeakReference<>(activity);
    launchedTransactionRef = transactionRef;
  }

  /** The request could not be launched after all. */
  @Nullable
  P abort() {
    P promise = pending;
    clear();
    launchedTransactionRef = null;
    return promise;
  }

  /**
   * An activity result arrived. Records it for {@code getLastResult()} and
   * returns the waiting promise, or {@code null} when none is waiting (for
   * example after a JavaScript reload).
   */
  @Nullable
  P complete(int resultCode, @Nullable String response, long now) {
    lastResult = new Record(Integer.valueOf(resultCode), response, launchedTransactionRef, now);
    launchedTransactionRef = null;
    P promise = pending;
    clear();
    return promise;
  }

  /**
   * The host activity resumed.
   *
   * <p>A different activity: the one that started the payment is gone and its
   * result can no longer arrive. The request is released and its promise is
   * returned for the caller to reject.
   *
   * <p>The same activity, with no result delivered: this happens when the UPI
   * app never really opened or finished without Android delivering a result
   * to this activity. If nothing arrives within {@link #RESUME_GRACE_MILLIS},
   * {@code handler} settles the request with "no result" (the JavaScript side
   * reports {@code completed} with {@code status: 'unknown'}, so the app asks
   * its server). Without this the request stayed pending forever and every
   * later {@code pay()} was refused with {@code IN_PROGRESS}.
   */
  @Nullable
  P onResume(@Nullable Object current, final NoResultHandler<P> handler) {
    if (pending == null || launchActivity == null) return null;
    Object started = launchActivity.get();
    if (started != null && started == current) {
      cancelGrace();
      final long id = requestId;
      cancelGrace = scheduler.schedule(new Runnable() {
        @Override
        public void run() {
          if (pending == null || requestId != id) return;
          P promise = pending;
          // launchedTransactionRef stays set: if the real result still turns
          // up later, complete() records it with the same transactionRef.
          lastResult = new Record(null, null, launchedTransactionRef, System.currentTimeMillis());
          clear();
          handler.onNoResult(promise);
        }
      }, RESUME_GRACE_MILLIS);
      return null;
    }
    P promise = pending;
    clear();
    return promise;
  }

  /** The activity went to the background again (for example back to the UPI app). */
  void onPause() {
    cancelGrace();
  }

  /** The React instance is going away: hand back the waiting promise. */
  @Nullable
  P invalidate() {
    P promise = pending;
    clear();
    // launchedTransactionRef stays: the result may still arrive at the
    // module of the next React instance.
    return promise;
  }

  @Nullable
  static Record lastResult() {
    return lastResult;
  }

  static void resetLastResultForTests() {
    lastResult = null;
    launchedTransactionRef = null;
  }

  private void cancelGrace() {
    Runnable cancel = cancelGrace;
    cancelGrace = null;
    if (cancel != null) cancel.run();
  }

  private void clear() {
    cancelGrace();
    pending = null;
    launchActivity = null;
  }
}
