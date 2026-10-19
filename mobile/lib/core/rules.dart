class FormRules {
  static final _email = RegExp(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", caseSensitive: false);
  static final _phone = RegExp(r"(?:\+91[\s\-]?)?[6-9]\d{9}\b");
  static final _aadhaar = RegExp(r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b");
  static final _pan = RegExp(r"\b[A-Z]{5}\d{4}[A-Z]\b", caseSensitive: false);

  static bool looksLikePersonalData(String text) =>
      _email.hasMatch(text) || _phone.hasMatch(text) || _aadhaar.hasMatch(text) || _pan.hasMatch(text);

  static String? indianMobile(String value) {
    final digits = value.replaceAll(RegExp(r"\D"), "");
    final national = digits.length == 12 && digits.startsWith("91") ? digits.substring(2) : digits;
    if (national.length != 10 || !"6789".contains(national[0])) return "Enter a 10-digit Indian mobile number.";
    return null;
  }

  static String? email(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty || !trimmed.contains("@") || trimmed.length > 320) return "Enter a valid email address.";
    return null;
  }

  static String? postTitle(String value) {
    final trimmed = value.trim();
    if (trimmed.length < 3 || trimmed.length > 120) return "Use a title between 3 and 120 characters.";
    if (looksLikePersonalData(trimmed)) return "Remove email addresses, phone numbers, and identity numbers.";
    return null;
  }

  static String? postBody(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty || trimmed.length > 5000) return "Write the post without personal contact details.";
    if (looksLikePersonalData(trimmed)) return "Remove email addresses, phone numbers, and identity numbers.";
    return null;
  }

  static String? displayName(String value) {
    final trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > 40) return "Use 2 to 40 characters.";
    if (looksLikePersonalData(trimmed)) return "Do not put an email or phone number in your display name.";
    return null;
  }
}
