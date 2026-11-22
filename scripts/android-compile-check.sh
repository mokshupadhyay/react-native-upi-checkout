#!/bin/sh
# Compile-check the Android Java sources without an app: javac against the
# Android SDK's android.jar and the react-android AAR from the local Gradle
# cache (put there by any React Native app build). Both source sets are
# compiled: main + oldarch, and main + newarch + the codegen spec generated
# from src/specs. Nothing is downloaded. This proves the code compiles; it
# does not prove it works on a device.
#
# Usage: sh scripts/android-compile-check.sh [react-native-version]
#
# For releases older than 0.71, which shipped the Android library inside the
# npm package instead of Maven, point REACT_NATIVE_AAR at that file, for
# example node_modules/react-native/android/com/facebook/react/react-native/0.64.4/react-native-0.64.4.aar
# from an unpacked `npm pack react-native@0.64.4`. Releases before 0.68 have no
# New Architecture, so only the old architecture is compiled for them.
set -eu

RN_VERSION="${1:-$(node -p "require('react-native/package.json').version")}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
CACHE="$HOME/.gradle/caches/modules-2/files-2.1"
OUT="android/build/compile-check"

fail() { echo "compile-check: $*" >&2; exit 1; }
find_one() { find "$CACHE/$1" -name "$2" 2>/dev/null | sort | tail -n 1; }

[ -n "$SDK" ] || fail "ANDROID_HOME is not set"
# ANDROID_PLATFORM picks the platform, for example android-36 (the default when installed).
PLATFORM="${ANDROID_PLATFORM:-android-36}"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"
[ -f "$ANDROID_JAR" ] || ANDROID_JAR="$(ls -d "$SDK"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -n 1)"
[ -f "$ANDROID_JAR" ] || fail "no android.jar under $SDK/platforms"

AAR="${REACT_NATIVE_AAR:-$(find_one "com.facebook.react/react-android/$RN_VERSION" "react-android-$RN_VERSION-release.aar")}"
[ -n "$AAR" ] && [ -f "$AAR" ] || fail "react-android $RN_VERSION is not in $CACHE; build any React Native $RN_VERSION app once, or set REACT_NATIVE_AAR"
RN_MINOR="$(echo "$RN_VERSION" | cut -d. -f2)"
ANNOTATION="$(find_one androidx.annotation 'annotation-jvm-*.jar')"
[ -n "$ANNOTATION" ] || ANNOTATION="$(find_one androidx.annotation 'annotation-1.*.jar')"
JSR305="$(find_one com.google.code.findbugs 'jsr305-3*.jar')"
PROGUARD="$(find_one com.facebook.yoga 'proguard-annotations-*.jar')"
INFER="$(find_one com.facebook.infer.annotation 'infer-annotation-*.jar')"
KOTLIN="$(find_one org.jetbrains.kotlin 'kotlin-stdlib-[0-9]*.jar')"
KOTLIN_ANNOTATIONS="$(find_one org.jetbrains.kotlin 'kotlin-annotations-jvm-*.jar')"
for jar in "$ANNOTATION" "$JSR305" "$PROGUARD" "$INFER"; do
  [ -n "$jar" ] || fail "a support jar is missing from $CACHE (androidx.annotation, jsr305, proguard-annotations, infer-annotation)"
done

rm -rf "$OUT"
mkdir -p "$OUT/aar" "$OUT/codegen" "$OUT/classes-oldarch" "$OUT/classes-newarch"
(cd "$OUT/aar" && unzip -q -o "$AAR" classes.jar)

node node_modules/@react-native/codegen/lib/cli/combine/combine-js-to-schema-cli.js "$OUT/codegen/schema.json" src/specs
node -e "
  const generate = require('@react-native/codegen/lib/generators/RNCodegen.js').generate;
  const schema = require(require('path').resolve('$OUT/codegen/schema.json'));
  const ok = generate(
    { libraryName: 'RNUpiCheckoutSpec', schema, outputDirectory: '$OUT/codegen/android', packageName: 'com.upicheckout', assumeNonnull: false },
    { generators: ['modulesAndroid'] },
  );
  if (!ok) process.exit(1);
"

CP="$ANDROID_JAR:$OUT/aar/classes.jar:$ANNOTATION:$JSR305:$PROGUARD:$INFER${KOTLIN:+:$KOTLIN}${KOTLIN_ANNOTATIONS:+:$KOTLIN_ANNOTATIONS}"
JAVAC_FLAGS="-source 8 -target 8 -Xlint:all -Xlint:-options -Werror -encoding UTF-8"

echo "android.jar:   $ANDROID_JAR"
echo "react-android: $AAR"

# shellcheck disable=SC2086
javac $JAVAC_FLAGS -cp "$CP" -d "$OUT/classes-oldarch" \
  android/src/main/java/com/upicheckout/*.java android/src/oldarch/java/com/upicheckout/*.java
echo "old architecture: OK"

if [ "$RN_MINOR" -lt 68 ] 2>/dev/null; then
  echo "new architecture: skipped (React Native $RN_VERSION predates it)"
  exit 0
fi

# shellcheck disable=SC2086
javac $JAVAC_FLAGS -cp "$CP" -d "$OUT/classes-newarch" \
  android/src/main/java/com/upicheckout/*.java android/src/newarch/java/com/upicheckout/*.java \
  "$OUT/codegen/android/java/com/upicheckout/NativeUpiCheckoutSpec.java"
echo "new architecture: OK"
