package com.upicheckout;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Plain-JVM tests for the Android classes that have no Android types:
 * {@link PaymentState} and {@link UpiResponseExtras}. No test framework: run
 * with scripts/android-jvm-test.sh, which exits non-zero on any failure.
 */
public final class UpiCheckoutJvmTest {
  private static int failures;
  private static int passes;

  public static void main(String[] args) {
    run("3: pay() while the app is in the background is refused", new Body() {
      public void run() { backgroundStartIsRefused(); }
    });
    run("3: same activity resumes without a result: settled after the grace period", new Body() {
      public void run() { sameActivityResumeWithoutResultSettles(); }
    });
    run("3: a result that arrives before the grace period ends wins", new Body() {
      public void run() { resultBeforeGraceWins(); }
    });
    run("3: pausing again cancels the grace period", new Body() {
      public void run() { pauseCancelsGrace(); }
    });
    run("3: a stale grace task does not settle a newer request", new Body() {
      public void run() { staleGraceIgnored(); }
    });
    run("3: a different activity resuming still rejects at once", new Body() {
      public void run() { replacedActivityRejects(); }
    });
    run("4: the last result is kept, with its transactionRef and time", new Body() {
      public void run() { lastResultKept(); }
    });
    run("4: a result with no waiting promise (after a reload) is still kept", new Body() {
      public void run() { lastResultKeptWithoutPromise(); }
    });
    run("4: a request settled without a result is kept with a null result code", new Body() {
      public void run() { lastResultKeptForNoResult(); }
    });
    run("5: an extra that fails to unparcel does not hide a valid response", new Body() {
      public void run() { badExtraDoesNotHideResponse(); }
    });
    run("5: response extra in other cases", new Body() {
      public void run() { responseKeyCaseVariants(); }
    });
    run("5: a bad extra is skipped in the separate-extras fallback", new Body() {
      public void run() { badExtraSkippedInFallback(); }
    });
    run("7: separate extras without a key named status are joined", new Body() {
      public void run() { fallbackWithoutStatusKey(); }
    });
    run("7: separate extras are joined in a fixed key order", new Body() {
      public void run() { fallbackOrderIsDeterministic(); }
    });
    run("7: unrelated extras alone give no response", new Body() {
      public void run() { unrelatedExtrasGiveNothing(); }
    });
    run("10: a response extra of \"null\" falls back to the separate extras", new Body() {
      public void run() { nullResponseFallsBack(); }
    });

    System.out.println();
    System.out.println(passes + " passed, " + failures + " failed");
    if (failures > 0) System.exit(1);
  }

  // --- PaymentState -------------------------------------------------------

  private static final class FakeScheduler implements PaymentState.Scheduler {
    final List<Runnable> tasks = new ArrayList<>();
    final List<Long> delays = new ArrayList<>();

    public Runnable schedule(final Runnable task, long delayMillis) {
      tasks.add(task);
      delays.add(delayMillis);
      return new Runnable() {
        public void run() { tasks.remove(task); }
      };
    }

    void runAll() {
      List<Runnable> due = new ArrayList<>(tasks);
      tasks.clear();
      for (Runnable task : due) task.run();
    }
  }

  private static final class Recorder implements PaymentState.NoResultHandler<String> {
    final List<String> settled = new ArrayList<>();

    public void onNoResult(String promise) { settled.add(promise); }
  }

  private static void backgroundStartIsRefused() {
    FakeScheduler scheduler = new FakeScheduler();
    PaymentState<String> state = new PaymentState<>(scheduler);
    Object activity = new Object();
    PaymentState.Refusal refusal = state.refusal(false, activity, false, false);
    if (refusal == null) {
      // 0.1.0 sequence: the launch goes ahead from a stopped activity, Android
      // never delivers a result, the user comes back to the same activity.
      state.begin("p1", activity, "R1", 1);
      state.onResume(activity, new Recorder());
      scheduler.runAll();
      check(!state.isPending(), "request still pending after the user came back; next pay() gets "
          + state.refusal(false, activity, false, true));
    }
    checkEquals(PaymentState.Refusal.NOT_RESUMED, refusal, "refusal");
    checkEquals("ACTIVITY_UNAVAILABLE", refusal == null ? null : refusal.code, "code");
    check(!state.isPending(), "nothing pending after a refusal");
    checkEquals(null, state.refusal(false, activity, false, true), "a resumed activity may start");
  }

  private static void sameActivityResumeWithoutResultSettles() {
    FakeScheduler scheduler = new FakeScheduler();
    PaymentState<String> state = new PaymentState<>(scheduler);
    Recorder recorder = new Recorder();
    Object activity = new Object();
    state.begin("p1", activity, "R1", 1);
    checkEquals(null, state.onResume(activity, recorder), "no rejection for the same activity");
    check(!scheduler.tasks.isEmpty(), "a grace task is scheduled");
    if (!scheduler.delays.isEmpty()) {
      checkEquals(PaymentState.RESUME_GRACE_MILLIS, scheduler.delays.get(0), "grace delay");
    }
    scheduler.runAll();
    checkEquals("[p1]", recorder.settled.toString(), "settled promises");
    check(!state.isPending(), "nothing pending after the grace period");
    checkEquals(null, state.refusal(false, activity, false, true), "a new payment may start");
  }

  private static void resultBeforeGraceWins() {
    FakeScheduler scheduler = new FakeScheduler();
    PaymentState<String> state = new PaymentState<>(scheduler);
    Recorder recorder = new Recorder();
    Object activity = new Object();
    state.begin("p1", activity, "R1", 1);
    state.onResume(activity, recorder);
    checkEquals("p1", state.complete(-1, "Status=SUCCESS", 3), "promise for the result");
    scheduler.runAll();
    checkEquals("[]", recorder.settled.toString(), "no extra settlement");
  }

  private static void pauseCancelsGrace() {
    FakeScheduler scheduler = new FakeScheduler();
    PaymentState<String> state = new PaymentState<>(scheduler);
    Recorder recorder = new Recorder();
    Object activity = new Object();
    state.begin("p1", activity, "R1", 1);
    state.onResume(activity, recorder);
    state.onPause();
    checkEquals(0, scheduler.tasks.size(), "grace task cancelled");
    scheduler.runAll();
    check(state.isPending(), "still waiting for the result");
    checkEquals("p1", state.complete(0, null, 3), "the result still settles it");
  }

  private static void staleGraceIgnored() {
    FakeScheduler scheduler = new FakeScheduler();
    PaymentState<String> state = new PaymentState<>(scheduler);
    Recorder recorder = new Recorder();
    Object activity = new Object();
    state.begin("p1", activity, "R1", 1);
    state.onResume(activity, recorder);
    List<Runnable> stale = new ArrayList<>(scheduler.tasks);
    state.complete(-1, "Status=SUCCESS", 3);
    state.begin("p2", activity, "R2", 4);
    for (Runnable task : stale) task.run();
    check(state.isPending(), "the newer request is still waiting");
    checkEquals("[]", recorder.settled.toString(), "nothing settled by the stale task");
  }

  private static void replacedActivityRejects() {
    PaymentState<String> state = new PaymentState<>(new FakeScheduler());
    state.begin("p1", new Object(), "R1", 1);
    checkEquals("p1", state.onResume(new Object(), new Recorder()), "promise to reject");
    check(!state.isPending(), "released");
  }

  private static void lastResultKept() {
    PaymentState<String> state = new PaymentState<>(new FakeScheduler());
    state.begin("p1", new Object(), "ORDER42", 1);
    state.complete(-1, "Status=SUCCESS", 1234);
    PaymentState.Record record = PaymentState.lastResult();
    check(record != null, "a record is kept");
    if (record == null) return;
    checkEquals(-1, record.resultCode, "resultCode");
    checkEquals("Status=SUCCESS", record.response, "response");
    checkEquals("ORDER42", record.transactionRef, "transactionRef");
    checkEquals(1234L, record.time, "time");
  }

  private static void lastResultKeptWithoutPromise() {
    // The request was started by a React instance that has since reloaded.
    PaymentState<String> before = new PaymentState<>(new FakeScheduler());
    before.begin("p1", new Object(), "ORDER7", 1);
    before.invalidate();
    PaymentState<String> after = new PaymentState<>(new FakeScheduler());
    checkEquals(null, after.complete(0, "Status=FAILURE", 99), "no promise waits");
    PaymentState.Record record = PaymentState.lastResult();
    check(record != null, "a record is kept");
    if (record == null) return;
    checkEquals("Status=FAILURE", record.response, "response");
    checkEquals("ORDER7", record.transactionRef, "transactionRef");
    checkEquals(99L, record.time, "time");
  }

  private static void lastResultKeptForNoResult() {
    FakeScheduler scheduler = new FakeScheduler();
    PaymentState<String> state = new PaymentState<>(scheduler);
    Object activity = new Object();
    state.begin("p1", activity, "ORDER8", 1);
    state.onResume(activity, new Recorder());
    scheduler.runAll();
    PaymentState.Record record = PaymentState.lastResult();
    check(record != null, "a record is kept");
    if (record == null) return;
    checkEquals(null, record.resultCode, "resultCode");
    checkEquals(null, record.response, "response");
    checkEquals("ORDER8", record.transactionRef, "transactionRef");

    // The real result turns up after all (multi-window): it replaces the record.
    checkEquals(null, state.complete(-1, "Status=SUCCESS", 77), "no promise waits any more");
    record = PaymentState.lastResult();
    checkEquals(-1, record == null ? null : record.resultCode, "late resultCode");
    checkEquals("ORDER8", record == null ? null : record.transactionRef, "late transactionRef");
  }

  // --- UpiResponseExtras --------------------------------------------------

  /** Extras backed by a map; keys in {@code broken} throw like a bad parcel. */
  private static final class FakeExtras implements UpiResponseExtras.Source {
    final Map<String, Object> values;
    final Set<String> broken = new LinkedHashSet<>();

    FakeExtras(Map<String, Object> values) { this.values = values; }

    public Set<String> keys() { return values.keySet(); }

    public Object get(String key) {
      if (broken.contains(key)) throw new RuntimeException("BadParcelableException for " + key);
      return values.get(key);
    }

    public String getString(String key) {
      Object value = get(key);
      return value instanceof String ? (String) value : null;
    }
  }

  private static Map<String, Object> ordered(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
    return map;
  }

  private static void badExtraDoesNotHideResponse() {
    // The broken extra comes first, as a HashMap may well order it.
    FakeExtras extras = new FakeExtras(ordered("partnerData", "x", "response", "txnId=T1&Status=SUCCESS"));
    extras.broken.add("partnerData");
    checkEquals("txnId=T1&Status=SUCCESS", UpiResponseExtras.read(extras), "response");
  }

  private static void responseKeyCaseVariants() {
    checkEquals("Status=SUCCESS", UpiResponseExtras.read(new FakeExtras(ordered("Response", "Status=SUCCESS"))), "Response");
    checkEquals("Status=SUCCESS", UpiResponseExtras.read(new FakeExtras(ordered("RESPONSE", "Status=SUCCESS"))), "RESPONSE");
    checkEquals("Status=SUCCESS", UpiResponseExtras.read(new FakeExtras(ordered("rEsPoNsE", "Status=SUCCESS"))), "rEsPoNsE");
  }

  private static void badExtraSkippedInFallback() {
    FakeExtras extras = new FakeExtras(ordered("Status", "SUCCESS", "bad", "x", "txnId", "T1"));
    extras.broken.add("bad");
    checkEquals("Status=SUCCESS&txnId=T1", UpiResponseExtras.read(extras), "joined");
  }

  private static void fallbackWithoutStatusKey() {
    checkEquals("txnId=T1&txnStatus=SUCCESS",
        UpiResponseExtras.read(new FakeExtras(ordered("txnStatus", "SUCCESS", "txnId", "T1"))), "txnStatus");
    checkEquals("ApprovalRefNo=123&responseCode=00",
        UpiResponseExtras.read(new FakeExtras(ordered("responseCode", "00", "ApprovalRefNo", 123))), "codes only");
  }

  private static void fallbackOrderIsDeterministic() {
    Map<String, Object> a = ordered("txnRef", "R1", "Status", "SUCCESS", "txnId", "T 1", "isUpi", Boolean.TRUE);
    Map<String, Object> b = new HashMap<>();
    b.put("isUpi", Boolean.TRUE);
    b.put("txnId", "T 1");
    b.put("Status", "SUCCESS");
    b.put("txnRef", "R1");
    String expected = "isUpi=true&Status=SUCCESS&txnId=T%201&txnRef=R1";
    checkEquals(expected, UpiResponseExtras.read(new FakeExtras(a)), "insertion order");
    checkEquals(expected, UpiResponseExtras.read(new FakeExtras(b)), "hash order");
  }

  private static void unrelatedExtrasGiveNothing() {
    checkEquals(null, UpiResponseExtras.read(new FakeExtras(ordered("foo", "bar", "count", 3))), "unrelated");
    checkEquals(null, UpiResponseExtras.read(new FakeExtras(ordered())), "empty");
  }

  private static void nullResponseFallsBack() {
    checkEquals("Status=SUCCESS",
        UpiResponseExtras.read(new FakeExtras(ordered("response", "null", "Status", "SUCCESS"))), "fallback");
    checkEquals(null, UpiResponseExtras.read(new FakeExtras(ordered("response", " NULL "))), "only null");
  }

  // --- tiny harness ------------------------------------------------------

  private interface Body {
    void run();
  }

  private static final List<String> current = new ArrayList<>();

  private static void run(String name, Body body) {
    PaymentState.resetLastResultForTests();
    current.clear();
    try {
      body.run();
    } catch (RuntimeException error) {
      current.add("threw " + error);
    }
    if (current.isEmpty()) {
      passes++;
      System.out.println("PASS " + name);
    } else {
      failures++;
      System.out.println("FAIL " + name);
      for (String message : current) System.out.println("     " + message);
    }
  }

  private static void check(boolean condition, String message) {
    if (!condition) current.add(message);
  }

  private static void checkEquals(Object expected, Object actual, String what) {
    boolean same = expected == null ? actual == null : expected.equals(actual);
    if (!same) current.add(what + ": expected <" + expected + "> but was <" + actual + ">");
  }
}
