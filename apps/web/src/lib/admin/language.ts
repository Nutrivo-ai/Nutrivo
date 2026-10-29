// The language names the admin screens print beside an ISO 639-1 code; an unknown code prints as itself.
const NAMES: Record<string, string> = {
  bg: "Bulgarian", cs: "Czech", da: "Danish", de: "German", el: "Greek", en: "English", es: "Spanish", et: "Estonian",
  fi: "Finnish", fr: "French", ga: "Irish", hr: "Croatian", hu: "Hungarian", it: "Italian", lt: "Lithuanian",
  lv: "Latvian", mt: "Maltese", nl: "Dutch", pl: "Polish", pt: "Portuguese", ro: "Romanian", sk: "Slovak",
  sl: "Slovenian", sv: "Swedish",
};

export function languageName(code: string | null | undefined): string {
  if (!code) return "Unknown language";
  return NAMES[code.toLowerCase()] ?? code.toUpperCase();
}
