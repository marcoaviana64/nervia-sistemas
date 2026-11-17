import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Assinatura própria: iptv-tv/assinatura.properties (fora do git; mesmas chaves do midia-tv). Sem ele, chave de depuração.
val assinatura = Properties().apply {
    val f = rootProject.file("assinatura.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    // Robolectric (TelaTest) precisa dos recursos do app nos testes de unidade
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { t -> (project.findProperty("robolectric.dir") as String?)?.let {
            t.systemProperty("robolectric.offline", "true"); t.systemProperty("robolectric.dependency.dir", it) } }
    }
    namespace = "app.iptv.player"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.iptv.player"
        minSdk = 24          // Android 7.0
        targetSdk = 36
        versionCode = 2
        versionName = "2.0"
    }

    signingConfigs {
        if (assinatura.isNotEmpty()) {
            create("propria") {
                storeFile = rootProject.file(assinatura.getProperty("arquivo"))
                storePassword = assinatura.getProperty("senha")
                keyAlias = assinatura.getProperty("apelido")
                keyPassword = assinatura.getProperty("senha_chave") ?: assinatura.getProperty("senha")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (assinatura.isNotEmpty()) signingConfigs.getByName("propria") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = true; checkReleaseBuilds = true; disable += setOf("IconLauncherShape", "GradleDependency", "NewerVersionAvailable", "SetTextI18n") }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    val media3 = "1.11.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-exoplayer-dash:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("com.google.zxing:core:3.5.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
