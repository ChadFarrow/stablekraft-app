#!/bin/bash

# DoerfelVerse Android APK Builder
echo "🎵 DoerfelVerse Android APK Builder"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Please run this script from the project root directory"
    exit 1
fi

# Step 1: Build the web app with PWA
echo "🌐 Step 1: Building web app with PWA..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Web app build failed!"
    exit 1
fi

echo "✅ Web app built successfully!"

# Step 2: Check if Android SDK is available
echo "🤖 Step 2: Checking Android SDK..."
if [ -z "$ANDROID_HOME" ]; then
    echo "⚠️  ANDROID_HOME is not set."
    echo "   To build the APK, you need to:"
    echo "   1. Install Android Studio or Android SDK"
    echo "   2. Set ANDROID_HOME environment variable"
    echo "   3. Run this script again"
    echo ""
    echo "   For now, the TWA project is ready in the 'android-twa' folder."
    echo "   You can open it in Android Studio to build manually."
    exit 0
fi

echo "✅ Android SDK found at: $ANDROID_HOME"

# Step 3: Build the Android APK
echo "📱 Step 3: Building Android APK..."
cd android-twa

if [ ! -f "gradlew" ]; then
    echo "❌ Gradle wrapper not found. Please run 'gradle wrapper' in the android-twa directory"
    exit 1
fi

# Make gradlew executable
chmod +x gradlew

# Build the APK
./gradlew assembleRelease

if [ $? -eq 0 ]; then
    echo "✅ APK built successfully!"
    echo "📱 APK location: android-twa/app/build/outputs/apk/release/app-release.apk"
    
    # Show APK size
    if [ -f "app/build/outputs/apk/release/app-release.apk" ]; then
        APK_SIZE=$(du -h app/build/outputs/apk/release/app-release.apk | cut -f1)
        echo "📏 APK size: $APK_SIZE"
    fi
    
    echo ""
    echo "🎉 Next steps:"
    echo "   1. Test the APK on an Android device"
    echo "   2. Sign the APK for release (see android-twa/README.md)"
    echo "   3. Upload to Google Play Console"
    
else
    echo "❌ APK build failed!"
    echo "   Check the error messages above and try again."
    exit 1
fi

cd .. 