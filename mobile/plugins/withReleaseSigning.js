/**
 * RELEASE IMZOSI.
 *
 * MUAMMO. Expo'ning standart shabloni release to'plamini DEBUG kaliti
 * bilan imzolaydi (`signingConfig signingConfigs.debug`). Bu kalit har
 * mashinada boshqacha va hammaga ma'lum. Oqibati:
 *   • Play Store bunday to'plamni qabul qilmaydi;
 *   • boshqa kalit bilan imzolangan yangi APK ESKISINI YANGILAMAYDI —
 *     do'konchi ilovani o'chirib, qaytadan o'rnatishga majbur bo'ladi.
 *
 * `android/` papkasi git'da yo'q (`expo prebuild` uni qayta yaratadi),
 * shuning uchun `build.gradle` ni qo'lda tahrirlash ma'nosiz — keyingi
 * prebuild'da yo'qoladi. Shu sabab o'zgarish shu PLAGIN orqali,
 * har prebuild'da qaytadan qo'llanadi.
 *
 * KALIT QAYERDA: `mobile/credentials/` (git'da yo'q). ANDROID/ ICHIDA
 * EMAS — `expo prebuild` o'sha papkani butunlay o'chirib qayta yaratadi
 * va kalit birinchi prebuild'dayoq yo'qolardi.
 *
 * ZAXIRALANG. Kalit yo'qolsa, o'rnatilgan ilovani boshqa yangilab
 * bo'lmaydi.
 *
 * Kalit topilmasa build TO'XTAMAYDI, lekin ogohlantirish chiqadi va
 * eski (debug) xatti-harakat qoladi — boshqa mashinada yoki CI'da
 * `assembleDebug` ishlayversin.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

/** `signingConfigs { … }` ichiga qo'shiladigan blok. */
const RELEASE_CONFIG = `
        release {
            // Kalit mobile/credentials/ da. rootProject — android/ papkasi.
            def props = new Properties()
            def f = rootProject.file('../credentials/keystore.properties')
            if (f.exists()) {
                f.withInputStream { props.load(it) }
                storeFile rootProject.file('../credentials/' + props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            } else {
                logger.warn('[dokon] credentials/keystore.properties topilmadi — ' +
                            'release DEBUG kaliti bilan imzolanadi!')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    // Ikki marta qo'llanmasin (prebuild ba'zan mavjud faylni qayta o'qiydi).
    if (gradle.includes("../credentials/keystore.properties")) return cfg;

    const anchor = 'signingConfigs {';
    if (!gradle.includes(anchor)) {
      // Jim o'tib ketish xavfli: APK debug kaliti bilan imzolanib,
      // buni hech kim sezmasdi.
      throw new Error(
        "[withReleaseSigning] build.gradle da `signingConfigs {` topilmadi. "
        + 'Shablon o\'zgargan — plaginni yangilang.');
    }
    gradle = gradle.replace(anchor, anchor + RELEASE_CONFIG);

    const eski = 'signingConfig signingConfigs.debug\n            def enableShrinkResources';
    if (!gradle.includes(eski)) {
      throw new Error(
        '[withReleaseSigning] release buildType da debug imzosi topilmadi. '
        + 'Shablon o\'zgargan — plaginni yangilang.');
    }
    gradle = gradle.replace(
      eski, 'signingConfig signingConfigs.release\n            def enableShrinkResources');

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
