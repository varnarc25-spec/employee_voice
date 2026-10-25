import "package:employee_voice/core/api_client.dart";
import "package:employee_voice/core/app_state.dart";
import "package:employee_voice/main.dart";
import "package:flutter_test/flutter_test.dart";
import "package:http/http.dart" as http;
import "package:http/testing.dart";

void main() {
  test("a rejected saved session is cleared", () async {
    final store = MemoryTokenStore();
    await store.save("old-access", "old-refresh");
    final state = AppState(
      store: store,
      client: ApiClient(
        baseUrl: "http://example.test",
        httpClient: MockClient((request) async => http.Response('{"detail":"That session is not valid."}', 401)),
      ),
    );

    await state.bootstrap();

    expect(state.signedIn, isFalse);
    expect(await store.read(), (null, null));
  });

  test("a saved session is renewed on startup", () async {
    final store = MemoryTokenStore();
    await store.save("old-access", "old-refresh");
    final state = AppState(
      store: store,
      client: ApiClient(
        baseUrl: "http://example.test",
        httpClient: MockClient((request) async {
          expect(request.url.path, "/api/v1/auth/refresh");
          return http.Response('{"accessToken":"new-access","refreshToken":"new-refresh"}', 200);
        }),
      ),
    );

    await state.bootstrap();

    expect(state.signedIn, isTrue);
    expect(state.access, "new-access");
    expect(await store.read(), ("new-access", "new-refresh"));
  });

  testWidgets("an expired session does not stay on the signed-in error", (tester) async {
    final store = MemoryTokenStore();
    await store.save("old-access", "old-refresh");
    final state = AppState(
      store: store,
      client: ApiClient(
        baseUrl: "http://example.test",
        httpClient: MockClient((request) async => http.Response('{"detail":"Sign in again."}', 401)),
      ),
    );

    await tester.pumpWidget(EmployeeVoiceApp(state: state));
    await tester.pumpAndSettle();

    expect(find.text("Continue to sign in"), findsOneWidget);
    expect(find.text("Sign in again."), findsNothing);
  });
}
