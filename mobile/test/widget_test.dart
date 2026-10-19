import "package:employee_voice/core/api_client.dart";
import "package:employee_voice/core/app_state.dart";
import "package:employee_voice/main.dart";
import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";

void main() {
  testWidgets("welcome explains that the app is independent", (tester) async {
    final state = AppState(
      client: ApiClient(baseUrl: "http://127.0.0.1:9"),
      store: MemoryTokenStore(),
    );
    await tester.pumpWidget(EmployeeVoiceApp(state: state));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(find.textContaining("not a government service"), 200);
    expect(find.textContaining("not a government service"), findsOneWidget);
    expect(find.textContaining("registered trade union"), findsOneWidget);
    expect(find.textContaining("does not constitute union membership"), findsOneWidget);
    expect(find.text("United employee voice"), findsOneWidget);
    await tester.scrollUntilVisible(find.text("Continue to sign in"), 200);
    expect(find.text("Continue to sign in"), findsOneWidget);
  });

  testWidgets("sign in asks for consent and a mobile number", (tester) async {
    final state = AppState(
      client: ApiClient(baseUrl: "http://127.0.0.1:9"),
      store: MemoryTokenStore(),
    );
    await tester.pumpWidget(EmployeeVoiceApp(state: state));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text("Continue to sign in"), 200);
    await tester.pumpAndSettle();
    await tester.tap(find.text("Continue to sign in"));
    await tester.pumpAndSettle();
    await tester.tap(find.text("Send code"));
    await tester.pumpAndSettle();
    expect(find.textContaining("18 or older"), findsWidgets);

    await tester.tap(find.byType(Checkbox).at(0));
    await tester.tap(find.byType(Checkbox).at(1));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).first, "123");
    await tester.tap(find.text("Send code"));
    await tester.pumpAndSettle();
    expect(find.text("Enter a 10-digit Indian mobile number."), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -500));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(OutlinedButton, "Continue with Google"), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, "Continue with LinkedIn"), findsOneWidget);
  });
}
