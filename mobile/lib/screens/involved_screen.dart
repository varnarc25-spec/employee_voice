import "package:flutter/material.dart";

import "../core/api_client.dart";
import "../core/widgets.dart";
import "../main.dart";

class InvolvedScreen extends StatefulWidget {
  const InvolvedScreen({super.key});

  @override
  State<InvolvedScreen> createState() => _InvolvedScreenState();
}

class _InvolvedScreenState extends State<InvolvedScreen> {
  bool _loading = true;
  String? _error;
  String _text = "";
  String _version = "";
  bool _agreed = false;
  bool _active = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final state = AppScope.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final copy = await state.client.get("/api/v1/legal/organizing-consent");
      final me = await state.client.get("/api/v1/me/organizing-interest", bearer: state.access);
      if (mounted) {
        setState(() {
          _text = copy["checkbox"] as String? ?? "";
          _version = copy["version"] as String? ?? "";
          _active = me["status"] == "active";
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _record() async {
    final state = AppScope.of(context);
    try {
      await state.client.post("/api/v1/me/organizing-interest", {"textVersion": _version}, bearer: state.access);
      await _load();
    } on ApiException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Future<void> _withdraw() async {
    final state = AppScope.of(context);
    await state.client.post("/api/v1/me/organizing-interest/withdraw", {}, bearer: state.access);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Get involved")),
      body: StatusBody(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const NoticeBanner("This is a voluntary note of interest in helping form a future employee organization. It is not trade-union membership and it is not a statutory register. Withdrawing it keeps your community account."),
            Text(_text),
            const SizedBox(height: 16),
            if (_active)
              FilledButton(onPressed: _withdraw, child: const Text("Withdraw my interest"))
            else ...[
              CheckboxListTile(
                value: _agreed,
                onChanged: (value) => setState(() => _agreed = value ?? false),
                title: const Text("I have read this and I want to record my interest."),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              FilledButton(onPressed: _agreed ? _record : null, child: const Text("Record interest")),
            ],
          ],
        ),
      ),
    );
  }
}
