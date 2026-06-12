import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/translation.json";
import zhCN from "./locales/zh-CN/translation.json";
import zhTW from "./locales/zh-TW/translation.json";

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN", "zh-TW"],
  resources: {
    en:      { translation: en },
    "zh-CN": { translation: zhCN },
    "zh-TW": { translation: zhTW },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
