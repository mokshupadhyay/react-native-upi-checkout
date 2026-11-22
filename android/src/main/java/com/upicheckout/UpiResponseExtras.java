package com.upicheckout;

import androidx.annotation.Nullable;

import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Turns the extras of a UPI app's result intent into one response string,
 * without Android types so it can be tested on a plain JVM
 * (android/jvm-test). {@link Source} wraps the intent's extras.
 *
 * <p>Every read is guarded on its own. On Android 13 and later the values of
 * a bundle are unparcelled one by one when read, so one extra that fails to
 * unparcel (for example a {@code Parcelable} class this app does not have)
 * must not discard the others. On older releases the whole bundle is
 * unparcelled at once, and such a bundle cannot be read at all.
 */
final class UpiResponseExtras {
  /** The extras of the result intent. Any method may throw for a malformed parcel. */
  interface Source {
    /** The extra keys, or {@code null} when there are no extras. */
    @Nullable
    Set<String> keys();

    /** The value of one extra, or {@code null}. */
    @Nullable
    Object get(String key);

    /** The value of one extra when it is a string, or {@code null}. */
    @Nullable
    String getString(String key);
  }

  private static final String[] RESPONSE_KEYS = {"response", "Response", "RESPONSE"};

  /**
   * Keys the JavaScript parser understands (src/response.ts, KEY_ALIASES),
   * lower-cased with everything but letters and digits removed. Any of them
   * among the extras means the app sent its result as separate extras.
   */
  private static final Set<String> KNOWN_KEYS = new HashSet<>(Arrays.asList(
      "status", "txnstatus",
      "txnid", "transactionid",
      "txnref", "trtxnref", "transactionref", "tr",
      "responsecode",
      "approvalrefno", "approvalref"));

  /** Case-insensitive, then case-sensitive, so the order never depends on the bundle. */
  private static final Comparator<String> KEY_ORDER = new Comparator<String>() {
    @Override
    public int compare(String a, String b) {
      int byLetters = String.CASE_INSENSITIVE_ORDER.compare(a, b);
      return byLetters != 0 ? byLetters : a.compareTo(b);
    }
  };

  private static final Charset UTF_8 = Charset.forName("UTF-8");

  private UpiResponseExtras() {}

  /**
   * The response string: the {@code response} extra most apps send, or, for
   * apps that send {@code Status}, {@code txnId} and so on as separate
   * extras, those extras joined as {@code key=value&...}, keys sorted, values
   * percent-encoded. {@code null} when there is neither.
   */
  @Nullable
  static String read(Source source) {
    String response = readResponseExtra(source);
    if (response != null) return response;
    return joinSeparateExtras(source);
  }

  @Nullable
  private static String readResponseExtra(Source source) {
    for (String key : RESPONSE_KEYS) {
      try {
        String value = source.getString(key);
        if (hasText(value)) return value;
      } catch (RuntimeException error) {
        // This extra could not be read; try the next spelling.
      }
    }
    // Other spellings, and values that are a CharSequence but not a String.
    for (String key : keys(source)) {
      if (!"response".equalsIgnoreCase(key)) continue;
      try {
        Object value = source.get(key);
        if (value instanceof CharSequence && hasText(value.toString())) return value.toString();
      } catch (RuntimeException error) {
        // Skip it.
      }
    }
    return null;
  }

  @Nullable
  private static String joinSeparateExtras(Source source) {
    List<String> keys = keys(source);
    boolean known = false;
    for (String key : keys) {
      if (KNOWN_KEYS.contains(normalize(key))) {
        known = true;
        break;
      }
    }
    if (!known) return null;

    Collections.sort(keys, KEY_ORDER);
    StringBuilder joined = new StringBuilder();
    for (String key : keys) {
      if ("response".equalsIgnoreCase(key)) continue;
      Object value;
      try {
        value = source.get(key);
      } catch (RuntimeException error) {
        continue;
      }
      if (!(value instanceof CharSequence || value instanceof Number || value instanceof Boolean)) continue;
      if (joined.length() > 0) joined.append('&');
      joined.append(encode(key)).append('=').append(encode(String.valueOf(value)));
    }
    return joined.length() > 0 ? joined.toString() : null;
  }

  private static List<String> keys(Source source) {
    try {
      Set<String> keys = source.keys();
      return keys == null ? new ArrayList<String>() : new ArrayList<>(keys);
    } catch (RuntimeException error) {
      return new ArrayList<>();
    }
  }

  /** Not blank and not the text {@code null} or {@code undefined}, which some apps send. */
  static boolean hasText(@Nullable String value) {
    if (value == null) return false;
    String trimmed = value.trim().toLowerCase(Locale.ROOT);
    return trimmed.length() > 0 && !trimmed.equals("null") && !trimmed.equals("undefined");
  }

  private static String normalize(String key) {
    return key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
  }

  /**
   * Percent-encode everything except ASCII letters, digits and {@code -_.~},
   * as UTF-8. A space becomes {@code %20}.
   */
  static String encode(String value) {
    StringBuilder out = new StringBuilder(value.length());
    for (byte b : value.getBytes(UTF_8)) {
      int c = b & 0xff;
      if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
          || c == '-' || c == '_' || c == '.' || c == '~') {
        out.append((char) c);
      } else {
        out.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
            .append(Character.toUpperCase(Character.forDigit(c & 0xf, 16)));
      }
    }
    return out.toString();
  }
}
