import "dart:convert";

import "package:http/http.dart" as http;

class ApiException implements Exception {
  ApiException(this.message, this.status);
  final String message;
  final int status;
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient({required this.baseUrl, http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final String baseUrl;
  final http.Client _http;

  /// Returns a replacement access token after a 401, or null when the session is gone.
  Future<String?> Function()? onUnauthorized;

  Future<Map<String, dynamic>> get(String path, {String? bearer, bool allowRefresh = true}) => _send("GET", path, bearer: bearer, allowRefresh: allowRefresh);

  Future<Map<String, dynamic>> post(String path, Object? body, {String? bearer, bool allowRefresh = true}) => _send("POST", path, body: body, bearer: bearer, allowRefresh: allowRefresh);

  Future<Map<String, dynamic>> put(String path, Object? body, {String? bearer, bool allowRefresh = true}) => _send("PUT", path, body: body, bearer: bearer, allowRefresh: allowRefresh);

  Future<void> delete(String path, {String? bearer, bool allowRefresh = true}) async {
    await _send("DELETE", path, bearer: bearer, allowRefresh: allowRefresh);
  }

  Future<Map<String, dynamic>> _send(String method, String path, {Object? body, String? bearer, bool allowRefresh = true}) async {
    try {
      return await _once(method, path, body: body, bearer: bearer);
    } on ApiException catch (error) {
      final refresh = onUnauthorized;
      if (error.status != 401 || !allowRefresh || bearer == null || refresh == null) rethrow;
      final next = await refresh();
      if (next == null || next.isEmpty) rethrow;
      return _once(method, path, body: body, bearer: next);
    }
  }

  Future<Map<String, dynamic>> _once(String method, String path, {Object? body, String? bearer}) async {
    final request = http.Request(method, Uri.parse("$baseUrl$path"));
    request.headers["Accept"] = "application/json";
    if (bearer != null) request.headers["Authorization"] = "Bearer $bearer";
    if (body != null) {
      request.headers["Content-Type"] = "application/json";
      request.body = jsonEncode(body);
    }
    final streamed = await _http.send(request);
    final response = await http.Response.fromStream(streamed);
    if (response.statusCode >= 400) {
      var message = "Request failed (${response.statusCode})";
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map && decoded["detail"] is String) message = decoded["detail"] as String;
      } catch (_) {}
      throw ApiException(message, response.statusCode);
    }
    if (response.body.isEmpty) return {};
    final decoded = jsonDecode(response.body);
    if (decoded is Map<String, dynamic>) return decoded;
    if (decoded is List) return {"items": decoded};
    return {};
  }
}
