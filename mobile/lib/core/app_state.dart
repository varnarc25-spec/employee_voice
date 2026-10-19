import "package:flutter/foundation.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";

import "api_client.dart";

abstract class TokenStore {
  Future<(String?, String?)> read();
  Future<void> save(String access, String refresh);
  Future<void> clear();
}

class MemoryTokenStore implements TokenStore {
  String? access;
  String? refresh;
  @override
  Future<void> clear() async {
    access = null;
    refresh = null;
  }

  @override
  Future<(String?, String?)> read() async => (access, refresh);

  @override
  Future<void> save(String accessToken, String refreshToken) async {
    access = accessToken;
    refresh = refreshToken;
  }
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore() : _storage = const FlutterSecureStorage();
  final FlutterSecureStorage _storage;

  @override
  Future<void> clear() async {
    await _storage.delete(key: "access");
    await _storage.delete(key: "refresh");
  }

  @override
  Future<(String?, String?)> read() async => (await _storage.read(key: "access"), await _storage.read(key: "refresh"));

  @override
  Future<void> save(String accessToken, String refreshToken) async {
    await _storage.write(key: "access", value: accessToken);
    await _storage.write(key: "refresh", value: refreshToken);
  }
}

class AppState extends ChangeNotifier {
  AppState({ApiClient? client, TokenStore? store, String? baseUrl})
      : client = client ?? ApiClient(baseUrl: baseUrl ?? const String.fromEnvironment("API_BASE_URL", defaultValue: "http://10.0.2.2:5080")),
        store = store ?? SecureTokenStore();

  final ApiClient client;
  final TokenStore store;
  String? access;
  String? refresh;
  bool ready = false;

  bool get signedIn => access != null && access!.isNotEmpty;

  Future<void> bootstrap() async {
    final saved = await store.read();
    access = saved.$1;
    refresh = saved.$2;
    ready = true;
    notifyListeners();
  }

  Future<void> _storeSession(Map<String, dynamic> body) async {
    access = body["accessToken"] as String;
    refresh = body["refreshToken"] as String;
    await store.save(access!, refresh!);
    notifyListeners();
  }

  Future<String> sendPhoneCode(String phone, {required bool adult, required bool terms}) async {
    final body = await client.post("/api/v1/auth/phone/send", {
      "phone": phone.trim(),
      "confirmedAdult": adult,
      "acceptedTerms": terms,
    });
    return body["message"] as String? ?? "Check your phone.";
  }

  Future<void> verifyPhoneCode(String phone, String code, {required bool adult, required bool terms}) async {
    final body = await client.post("/api/v1/auth/phone/verify", {
      "phone": phone.trim(),
      "code": code.trim(),
      "confirmedAdult": adult,
      "acceptedTerms": terms,
    });
    await _storeSession(body);
  }

  Future<void> signInWithGoogle(String idToken, {required bool adult, required bool terms}) async {
    final body = await client.post("/api/v1/auth/google", {
      "idToken": idToken,
      "confirmedAdult": adult,
      "acceptedTerms": terms,
    });
    await _storeSession(body);
  }

  Future<void> signInWithLinkedIn(String code, String codeVerifier, {required bool adult, required bool terms}) async {
    final body = await client.post("/api/v1/auth/linkedin", {
      "code": code,
      "codeVerifier": codeVerifier,
      "confirmedAdult": adult,
      "acceptedTerms": terms,
    });
    await _storeSession(body);
  }

  Future<String?> developmentPhoneCode() async {
    final body = await client.get("/api/v1/dev/mailbox");
    final items = body["items"] as List? ?? [];
    for (final item in items) {
      if (item is Map && item["purpose"] == "phone_otp" && item["token"] is String) return item["token"] as String;
    }
    return null;
  }

  Future<String> requestLink(String email) async {
    final body = await client.post("/api/v1/auth/magic-link", {
      "email": email.trim(),
      "confirmedAdult": true,
      "acceptedTerms": true,
      "client": "mobile",
    });
    return body["message"] as String? ?? "Check your email.";
  }

  Future<void> consume(String token) async {
    final body = await client.post("/api/v1/auth/magic-link/consume", {"token": token.trim(), "client": "mobile"});
    await _storeSession(body);
  }

  Future<void> signOut() async {
    final currentRefresh = refresh;
    final currentAccess = access;
    access = null;
    refresh = null;
    await store.clear();
    notifyListeners();
    if (currentRefresh != null) {
      try {
        await client.post("/api/v1/auth/sign-out", {"refreshToken": currentRefresh, "client": "mobile"}, bearer: currentAccess);
      } catch (_) {}
    }
  }
}
