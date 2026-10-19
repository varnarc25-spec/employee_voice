import "package:employee_voice/core/rules.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  test("rejects contact details in a post", () {
    expect(FormRules.postBody("Write me at person@example.com"), isNotNull);
    expect(FormRules.postBody("Call 9876543210"), isNotNull);
    expect(FormRules.postBody("The team was asked to work weekends."), isNull);
  });

  test("requires a display name that is not an email", () {
    expect(FormRules.displayName("A"), isNotNull);
    expect(FormRules.displayName("river@example.com"), isNotNull);
    expect(FormRules.displayName("River"), isNull);
  });
}
