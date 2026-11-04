import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// URL do Supabase e chave publicável: as mesmas do site (site/config.js), para não haver duas fontes.
val configJs = rootProject.file("../site/config.js").readText()
fun lerConfig(nome: String): String =
    Regex("""$nome\s*:\s*["']([^"']+)["']""").find(configJs)?.groupValues?.get(1)
        ?: throw GradleException("$nome não encontrado em site/config.js")

// Assinatura de produção: midia-tv/assinatura.properties (fora do git). Sem ele, o APK sai assinado com a chave de
// depuração (só para piloto: atualizar depois para a chave de produção exige desinstalar e instalar de novo).
val assinatura = Properties().apply {
    val f = rootProject.file("assinatura.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    // Robolectric (teste da tela de espera, VitrineTest) precisa dos recursos do app nos testes de unidade
    testOptions {
        unitTests.isIncludeAndroidResources = true
        // sem internet para o Maven (ou com 429): -Probolectric.dir=/pasta/com/o/android-all-instrumented.jar
        unitTests.all { t -> (project.findProperty("robolectric.dir") as String?)?.let {
            t.systemProperty("robolectric.offline", "true"); t.systemProperty("robolectric.dependency.dir", it) } }
    }
    namespace = "br.com.nervia.midia"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.com.nervia.midia"
        minSdk = 24          // Android 7.0
        targetSdk = 36
        versionCode = 3
        versionName = "1.2"
        buildConfigField("String", "SUPABASE_URL", "\"${lerConfig("SUPABASE_URL")}\"")
        buildConfigField("String", "SUPABASE_CHAVE", "\"${lerConfig("SUPABASE_ANON_KEY")}\"")
    }

    signingConfigs {
        if (assinatura.isNotEmpty()) {
            create("producao") {
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
            signingConfig = if (assinatura.isNotEmpty()) signingConfigs.getByName("producao") else signingConfigs.getByName("debug")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = true; checkReleaseBuilds = true; disable += setOf("IconLauncherShape", "GradleDependency", "NewerVersionAvailable") }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    val media3 = "1.11.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
