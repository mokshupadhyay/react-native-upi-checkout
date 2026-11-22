#!/bin/sh
# Run the plain-JVM tests in android/jvm-test against the Android classes that
# use no Android types (PaymentState, UpiResponseExtras). Needs only a JDK
# and the androidx.annotation jar from the local Gradle cache. These tests
# cover the request state and the extras parsing; they do not replace the
# device checks in docs/DEVICE_TESTING.md.
#
# Usage: sh scripts/android-jvm-test.sh
set -eu

CACHE="$HOME/.gradle/caches/modules-2/files-2.1"
OUT="android/build/jvm-test"

fail() { echo "jvm-test: $*" >&2; exit 1; }
find_one() { find "$CACHE/$1" -name "$2" 2>/dev/null | sort | tail -n 1; }

ANNOTATION="$(find_one androidx.annotation 'annotation-jvm-*.jar')"
[ -n "$ANNOTATION" ] || ANNOTATION="$(find_one androidx.annotation 'annotation-1.*.jar')"
[ -n "$ANNOTATION" ] || fail "androidx.annotation is missing from $CACHE"
# annotation-jvm is compiled from Kotlin; javac needs these to read it cleanly.
KOTLIN="$(find_one org.jetbrains.kotlin 'kotlin-stdlib-[0-9]*.jar')"
KOTLIN_ANNOTATIONS="$(find_one org.jetbrains.kotlin 'kotlin-annotations-jvm-*.jar')"
CP="$ANNOTATION${KOTLIN:+:$KOTLIN}${KOTLIN_ANNOTATIONS:+:$KOTLIN_ANNOTATIONS}"

rm -rf "$OUT"
mkdir -p "$OUT"
javac -source 8 -target 8 -Xlint:all -Xlint:-options -Werror -encoding UTF-8 -cp "$CP" -d "$OUT" \
  android/src/main/java/com/upicheckout/PaymentState.java \
  android/src/main/java/com/upicheckout/UpiResponseExtras.java \
  android/jvm-test/java/com/upicheckout/UpiCheckoutJvmTest.java
java -cp "$OUT:$CP" com.upicheckout.UpiCheckoutJvmTest
