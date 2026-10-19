import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

import "../core/rules.dart";
import "../core/widgets.dart";
import "../main.dart";

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _items = [];
  bool _replies = true;
  bool _announcements = true;
  bool _polls = true;

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
      final body = await state.client.get("/api/v1/notifications", bearer: state.access);
      final prefs = await state.client.get("/api/v1/me/notification-preferences", bearer: state.access);
      if (mounted) {
        setState(() {
          _items = (body["items"] as List? ?? []).cast<Map<String, dynamic>>();
          _replies = prefs["repliesEnabled"] == true;
          _announcements = prefs["announcementsEnabled"] == true;
          _polls = prefs["pollDeadlinesEnabled"] == true;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _savePrefs() async {
    final state = AppScope.of(context);
    await state.client.put("/api/v1/me/notification-preferences", {
      "repliesEnabled": _replies,
      "announcementsEnabled": _announcements,
      "pollDeadlinesEnabled": _polls,
    }, bearer: state.access);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Alerts")),
      body: StatusBody(
        loading: _loading,
        error: _error,
        onRetry: _load,
        empty: false,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const NoticeBanner("Push previews stay generic. They do not include post text or organizing-interest details."),
            SwitchListTile(value: _replies, onChanged: (value) => setState(() => _replies = value), title: const Text("Replies")),
            SwitchListTile(value: _announcements, onChanged: (value) => setState(() => _announcements = value), title: const Text("Announcements")),
            SwitchListTile(value: _polls, onChanged: (value) => setState(() => _polls = value), title: const Text("Poll deadlines")),
            Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: _savePrefs, child: const Text("Save alert settings"))),
            const SizedBox(height: 16),
            if (_items.isEmpty) const Text("No alerts yet."),
            for (final item in _items) ListTile(title: Text(item["title"] as String? ?? "Update"), subtitle: Text(item["body"] as String? ?? "")),
          ],
        ),
      ),
    );
  }
}

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _name = TextEditingController();
  final _city = TextEditingController();
  String _experience = "unspecified";
  String _industry = "unspecified";
  bool _loading = true;
  String? _error;
  String _verification = "unverified";
  List<Map<String, dynamic>> _sessions = [];
  final _delete = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _delete.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final state = AppScope.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final me = await state.client.get("/api/v1/me", bearer: state.access);
      final profile = me["profile"] as Map<String, dynamic>? ?? {};
      final verification = me["verification"] as Map<String, dynamic>? ?? {};
      final sessions = await state.client.get("/api/v1/me/sessions", bearer: state.access);
      if (mounted) {
        _name.text = profile["displayName"] as String? ?? "";
        _city.text = profile["city"] as String? ?? "";
        _experience = profile["experienceBand"] as String? ?? _experience;
        _industry = profile["industry"] as String? ?? _industry;
        setState(() {
          _verification = verification["status"] as String? ?? "unverified";
          _sessions = (sessions["items"] as List? ?? []).cast<Map<String, dynamic>>();
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (FormRules.displayName(_name.text) != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(FormRules.displayName(_name.text)!)));
      return;
    }
    final state = AppScope.of(context);
    await state.client.put("/api/v1/me/profile", {
      "displayName": _name.text.trim(),
      "city": _city.text.trim().isEmpty ? null : _city.text.trim(),
      "experienceBand": _experience,
      "industry": _industry,
    }, bearer: state.access);
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Profile saved.")));
  }

  Future<void> _deleteAccount() async {
    if (_delete.text.trim().toLowerCase() != "delete my account") {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Type delete my account to confirm.")));
      return;
    }
    final state = AppScope.of(context);
    await state.client.post("/api/v1/me/privacy-requests", {"type": "deletion", "phrase": "delete my account"}, bearer: state.access);
    await state.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text("Profile")),
      body: StatusBody(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text("Verification: $_verification"),
            const SizedBox(height: 8),
            TextButton(onPressed: () => context.push("/verification"), child: const Text("Employment verification")),
            TextFormField(controller: _name, decoration: const InputDecoration(labelText: "Display name", border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextFormField(controller: _city, decoration: const InputDecoration(labelText: "City (optional)", border: OutlineInputBorder())),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _experience,
              decoration: const InputDecoration(labelText: "Experience", border: OutlineInputBorder()),
              items: const [
                DropdownMenuItem(value: "unspecified", child: Text("Prefer not to say")),
                DropdownMenuItem(value: "y0To2", child: Text("0 to 2 years")),
                DropdownMenuItem(value: "y3To5", child: Text("3 to 5 years")),
                DropdownMenuItem(value: "y6To10", child: Text("6 to 10 years")),
                DropdownMenuItem(value: "y11To15", child: Text("11 to 15 years")),
                DropdownMenuItem(value: "y16Plus", child: Text("16 years or more")),
              ],
              onChanged: (value) => setState(() => _experience = value ?? _experience),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _industry,
              decoration: const InputDecoration(labelText: "Industry", border: OutlineInputBorder()),
              items: const [
                DropdownMenuItem(value: "unspecified", child: Text("Prefer not to say")),
                DropdownMenuItem(value: "softwareServices", child: Text("Software services")),
                DropdownMenuItem(value: "productIt", child: Text("Product IT")),
                DropdownMenuItem(value: "bpoKpo", child: Text("BPO or KPO")),
                DropdownMenuItem(value: "fintech", child: Text("Fintech")),
                DropdownMenuItem(value: "healthtech", child: Text("Healthtech")),
                DropdownMenuItem(value: "edtech", child: Text("Edtech")),
                DropdownMenuItem(value: "otherIt", child: Text("Other IT")),
              ],
              onChanged: (value) => setState(() => _industry = value ?? _industry),
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: _save, child: const Text("Save profile")),
            const Divider(height: 32),
            const Text("Sessions"),
            for (final session in _sessions)
              ListTile(
                title: Text(session["clientLabel"] as String? ?? "Session"),
                trailing: TextButton(
                  onPressed: () async {
                    await state.client.delete("/api/v1/me/sessions/${session["id"]}", bearer: state.access);
                    await _load();
                  },
                  child: const Text("Revoke"),
                ),
              ),
            OutlinedButton(
              onPressed: () async {
                final export = await state.client.get("/api/v1/me/export", bearer: state.access);
                final posts = (export["posts"] as List?)?.length ?? 0;
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Your data export is ready. It includes $posts posts. The file stays on this device.")));
                }
              },
              child: const Text("Request my data"),
            ),
            OutlinedButton(onPressed: () => state.client.post("/api/v1/me/deactivate", null, bearer: state.access).then((_) => state.signOut()), child: const Text("Deactivate account")),
            const SizedBox(height: 16),
            const Text("You can also request deletion on the web at /account/delete without opening the app."),
            TextField(controller: _delete, decoration: const InputDecoration(labelText: "Type delete my account", border: OutlineInputBorder())),
            const SizedBox(height: 8),
            FilledButton(onPressed: _deleteAccount, child: const Text("Delete account")),
            TextButton(onPressed: state.signOut, child: const Text("Sign out")),
          ],
        ),
      ),
    );
  }
}

class VerificationScreen extends StatefulWidget {
  const VerificationScreen({super.key});

  @override
  State<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends State<VerificationScreen> {
  final _workEmail = TextEditingController();
  final _employer = TextEditingController();
  final _note = TextEditingController();
  String _status = "unverified";
  bool _loading = true;

  @override
  void dispose() {
    _workEmail.dispose();
    _employer.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final state = AppScope.of(context);
    final me = await state.client.get("/api/v1/me/verification", bearer: state.access);
    if (mounted) {
      setState(() {
        _status = me["status"] as String? ?? "unverified";
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text("Verification")),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text("Status: $_status"),
                const SizedBox(height: 12),
                const NoticeBanner("A matching work-email domain is one check. It does not prove that you currently work there."),
                TextField(controller: _workEmail, decoration: const InputDecoration(labelText: "Work email", border: OutlineInputBorder())),
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: () async {
                    await state.client.post("/api/v1/me/verification/work-email", {"email": _workEmail.text.trim()}, bearer: state.access);
                    await _load();
                  },
                  child: const Text("Send work-email check"),
                ),
                const SizedBox(height: 16),
                TextField(controller: _employer, decoration: const InputDecoration(labelText: "Employer, for the reviewer only", border: OutlineInputBorder())),
                const SizedBox(height: 8),
                TextField(controller: _note, minLines: 3, maxLines: 5, decoration: const InputDecoration(labelText: "Note for a reviewer", border: OutlineInputBorder())),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    await state.client.post("/api/v1/me/verification/manual", {"employerName": _employer.text.trim(), "note": _note.text.trim()}, bearer: state.access);
                    await _load();
                  },
                  child: const Text("Ask for manual review"),
                ),
              ],
            ),
    );
  }
}

class GuidelinesScreen extends StatefulWidget {
  const GuidelinesScreen({super.key, this.initialSlug = "guidelines"});

  final String initialSlug;

  @override
  State<GuidelinesScreen> createState() => _GuidelinesScreenState();
}

class _GuidelinesScreenState extends State<GuidelinesScreen> {
  String _text = "";
  bool _loading = true;
  String? _error;
  late String _slug = widget.initialSlug;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load(_slug));
  }

  Future<void> _load(String slug) async {
    final state = AppScope.of(context);
    setState(() {
      _slug = slug;
      _loading = true;
      _error = null;
    });
    try {
      final body = await state.client.get("/api/v1/legal/$slug");
      if (mounted) setState(() => _text = body["body"] as String? ?? "");
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Guidelines")),
      body: Column(
        children: [
          Wrap(
            spacing: 8,
            children: [
              TextButton(onPressed: () => _load("guidelines"), child: const Text("Guidelines")),
              TextButton(onPressed: () => _load("privacy"), child: const Text("Privacy")),
              TextButton(onPressed: () => _load("terms"), child: const Text("Terms")),
              TextButton(onPressed: () => _load("appeals"), child: const Text("Appeals")),
            ],
          ),
          Expanded(
            child: StatusBody(
              loading: _loading,
              error: _error,
              onRetry: () => _load(_slug),
              child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: Text(_text)),
            ),
          ),
        ],
      ),
    );
  }
}
