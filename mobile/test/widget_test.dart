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

    expect(find.textContaining("not a government service"), findsOneWidget);
    expect(find.textContaining("registered trade union"), findsOneWidget);
    expect(find.textContaining("does not constitute union membership"), findsOneWidget);
    expect(find.text("United employee voice"), findsOneWidget);
    expect(find.text("Continue to sign in"), findsOneWidget);
  });

  testWidgets("sign in is Gmail only", (tester) async {
    final state = AppState(
      client: ApiClient(baseUrl: "http://127.0.0.1:9"),
      store: MemoryTokenStore(),
    );
    await tester.pumpWidget(EmployeeVoiceApp(state: state));
    await tester.pumpAndSettle();
    await tester.tap(find.text("Continue to sign in"));
    await tester.pumpAndSettle();
    expect(find.text("Login"), findsOneWidget);
    expect(find.text("Continue with Gmail"), findsOneWidget);
    expect(find.text("Send code"), findsNothing);
    expect(find.text("Continue with Auth0"), findsNothing);
    expect(find.text("Continue with LinkedIn"), findsNothing);
  });
}
