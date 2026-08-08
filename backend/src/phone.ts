import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export function normalizePhoneNumber(
  input: string,
  defaultRegion = process.env.DEFAULT_PHONE_REGION ?? "CA",
): string | null {
  const cleaned = input.trim();
  if (!cleaned) return null;

  const region = defaultRegion.toUpperCase() as CountryCode;
  const direct = parsePhoneNumberFromString(cleaned, region);
  if (direct?.isValid()) return direct.number;

  for (const candidate of cleaned.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []) {
    const parsed = parsePhoneNumberFromString(candidate, region);
    if (parsed?.isValid()) return parsed.number;
  }

  const emailDigits = cleaned.match(/(?:^|[<\s])(?:sms[-_.])?(\+?\d{10,15})@/i)?.[1];
  if (emailDigits) {
    const parsed = parsePhoneNumberFromString(emailDigits, region);
    if (parsed?.isValid()) return parsed.number;
  }

  return null;
}

export function maskPhoneNumber(phoneNumber: string): string {
  return phoneNumber.length > 5
    ? `${phoneNumber.slice(0, 5)}…${phoneNumber.slice(-2)}`
    : "***";
}
