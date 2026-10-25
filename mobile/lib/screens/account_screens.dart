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

class _PlaceOption {
  const _PlaceOption(this.code, this.name);
  final int code;
  final String name;
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _name = TextEditingController();
  final _city = TextEditingController();
  final _villageSearch = TextEditingController();
  String _experience = "unspecified";
  String _industry = "unspecified";
  bool _loading = true;
  String? _error;
  String _verification = "unverified";
  List<Map<String, dynamic>> _sessions = [];
  final _delete = TextEditingController();
  List<_PlaceOption> _states = [];
  List<_PlaceOption> _districts = [];
  List<_PlaceOption> _subDistricts = [];
  List<_PlaceOption> _villages = [];
  int? _stateCode;
  int? _districtCode;
  int? _subDistrictCode;
  int? _villageCode;
  String? _villageName;
  String? _electionSummary;
  List<String> _nominees = [];
  bool _electionMatched = false;
  bool _electionLoading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _villageSearch.dispose();
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
      final location = profile["location"] as Map<String, dynamic>? ?? {};
      final verification = me["verification"] as Map<String, dynamic>? ?? {};
      final sessions = await state.client.get("/api/v1/me/sessions", bearer: state.access);
      final states = await state.client.get("/api/v1/locations/states", bearer: state.access);
      if (!mounted) return;
      _name.text = profile["displayName"] as String? ?? "";
      _city.text = profile["city"] as String? ?? "";
      _experience = profile["experienceBand"] as String? ?? _experience;
      _industry = profile["industry"] as String? ?? _industry;
      _stateCode = location["stateCode"] as int?;
      _districtCode = location["districtCode"] as int?;
      _subDistrictCode = location["subDistrictCode"] as int?;
      _villageCode = location["villageCode"] as int?;
      _villageName = location["villageName"] as String?;
      _states = _places(states);
      if (_stateCode != null) await _loadDistricts(keepChildren: true);
      if (_districtCode != null) await _loadSubDistricts(keepChildren: true);
      if (_subDistrictCode != null) await _loadVillages();
      if (_villageCode != null) await _loadElection();
      if (mounted) {
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

  List<_PlaceOption> _places(Map<String, dynamic> body) {
    final items = (body["items"] as List? ?? []).cast<Map<String, dynamic>>();
    return items.map((item) => _PlaceOption(item["lgdCode"] as int, item["nameEn"] as String)).toList();
  }

  Future<void> _loadDistricts({bool keepChildren = false}) async {
    final state = AppScope.of(context);
    if (!keepChildren) {
      _districtCode = null;
      _subDistrictCode = null;
      _villageCode = null;
      _villageName = null;
      _electionSummary = null;
      _nominees = [];
      _electionMatched = false;
      _subDistricts = [];
      _villages = [];
    }
    if (_stateCode == null) {
      _districts = [];
      return;
    }
    final body = await state.client.get("/api/v1/locations/districts?stateCode=$_stateCode", bearer: state.access);
    _districts = _places(body);
  }

  Future<void> _loadSubDistricts({bool keepChildren = false}) async {
    final state = AppScope.of(context);
    if (!keepChildren) {
      _subDistrictCode = null;
      _villageCode = null;
      _villageName = null;
      _electionSummary = null;
      _nominees = [];
      _electionMatched = false;
      _villages = [];
    }
    if (_districtCode == null) {
      _subDistricts = [];
      return;
    }
    final body = await state.client.get("/api/v1/locations/sub-districts?districtCode=$_districtCode", bearer: state.access);
    _subDistricts = _places(body);
  }

  Future<void> _loadVillages() async {
    final state = AppScope.of(context);
    if (_subDistrictCode == null) {
      _villages = [];
      return;
    }
    final query = _villageSearch.text.trim();
    final path = query.isEmpty
        ? "/api/v1/locations/villages?subDistrictCode=$_subDistrictCode"
        : "/api/v1/locations/villages?subDistrictCode=$_subDistrictCode&q=${Uri.encodeQueryComponent(query)}";
    final body = await state.client.get(path, bearer: state.access);
    final villages = _places(body);
    if (_villageCode != null && _villageName != null && villages.every((item) => item.code != _villageCode)) {
      villages.insert(0, _PlaceOption(_villageCode!, _villageName!));
    }
    _villages = villages;
  }

  Future<void> _loadElection() async {
    if (_villageCode == null) {
      _electionSummary = null;
      _nominees = [];
      _electionMatched = false;
      return;
    }
    final state = AppScope.of(context);
    if (mounted) setState(() => _electionLoading = true);
    try {
      final body = await state.client.get("/api/v1/locations/villages/$_villageCode/election", bearer: state.access);
      if (!mounted) return;
      if (body["matched"] == true) {
        final party = body["party"] as String?;
        final partyLabel = party == null || party.isEmpty ? "" : " ($party)";
        _electionMatched = true;
        _electionSummary = "${body["election"]}\n${body["constituencyName"]}\nWon by ${body["winner"]}$partyLabel";
        final people = (body["nominees"] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
        _nominees = people.map((person) {
          final name = person["name"] as String? ?? "";
          final nomineeParty = person["party"] as String?;
          final votes = person["votes"];
          final partyText = nomineeParty == null || nomineeParty.isEmpty ? "" : " ($nomineeParty)";
          final voteText = votes is num ? " · $votes votes" : "";
          return "$name$partyText$voteText";
        }).where((line) => line.trim().isNotEmpty).toList();
      } else {
        _electionMatched = false;
        _electionSummary = body["message"] as String? ?? "No election result for this village.";
        _nominees = [];
      }
    } catch (error) {
      if (!mounted) return;
      _electionMatched = false;
      _nominees = [];
      _electionSummary = error.toString();
    } finally {
      _electionLoading = false;
    }
  }

  Future<void> _save() async {
    if (FormRules.displayName(_name.text) != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(FormRules.displayName(_name.text)!)));
      return;
    }
    final picked = [_stateCode, _districtCode, _subDistrictCode, _villageCode];
    if (picked.any((code) => code != null) && picked.any((code) => code == null)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Choose a state, district, sub-district, and village.")));
      return;
    }
    final state = AppScope.of(context);
    try {
      await state.client.put("/api/v1/me/profile", {
        "displayName": _name.text.trim(),
        "city": _city.text.trim().isEmpty ? null : _city.text.trim(),
        "experienceBand": _experience,
        "industry": _industry,
        "stateCode": _stateCode,
        "districtCode": _districtCode,
        "subDistrictCode": _subDistrictCode,
        "villageCode": _villageCode,
      }, bearer: state.access);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Profile saved.")));
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Widget _placeDropdown({
    required String label,
    required int? value,
    required List<_PlaceOption> options,
    required ValueChanged<int?> onChanged,
  }) {
    if (options.isEmpty) {
      return InputDecorator(
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        child: const Text("Choose the level above first"),
      );
    }
    final selected = options.any((option) => option.code == value) ? value : null;
    return DropdownButtonFormField<int>(
      key: ValueKey("$label-$selected-${options.length}"),
      initialValue: selected,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      items: [for (final option in options) DropdownMenuItem(value: option.code, child: Text(option.name))],
      onChanged: options.isEmpty ? null : onChanged,
    );
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
            const SizedBox(height: 16),
            const Text("Location"),
            const SizedBox(height: 8),
            _placeDropdown(
              label: "State",
              value: _stateCode,
              options: _states,
              onChanged: (value) async {
                setState(() => _stateCode = value);
                await _loadDistricts();
                if (mounted) setState(() {});
              },
            ),
            const SizedBox(height: 12),
            _placeDropdown(
              label: "District",
              value: _districtCode,
              options: _districts,
              onChanged: (value) async {
                setState(() => _districtCode = value);
                await _loadSubDistricts();
                if (mounted) setState(() {});
              },
            ),
            const SizedBox(height: 12),
            _placeDropdown(
              label: "Sub-district",
              value: _subDistrictCode,
              options: _subDistricts,
              onChanged: (value) async {
                setState(() {
                  _subDistrictCode = value;
                  _villageCode = null;
                  _villageName = null;
                  _electionSummary = null;
                  _nominees = [];
                  _electionMatched = false;
                  _villageSearch.clear();
                });
                await _loadVillages();
                if (mounted) setState(() {});
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _villageSearch,
              decoration: const InputDecoration(labelText: "Search villages", border: OutlineInputBorder()),
              onSubmitted: (_) async {
                await _loadVillages();
                if (mounted) setState(() {});
              },
            ),
            const SizedBox(height: 12),
            _placeDropdown(
              label: "Village",
              value: _villageCode,
              options: _villages,
              onChanged: (value) async {
                final match = _villages.where((item) => item.code == value);
                setState(() {
                  _villageCode = value;
                  _villageName = match.isEmpty ? null : match.first.name;
                  _electionSummary = null;
                  _nominees = [];
                  _electionMatched = false;
                });
                await _loadElection();
                if (mounted) setState(() {});
              },
            ),
            if (_electionLoading) const Padding(padding: EdgeInsets.only(top: 12), child: Text("Looking up the latest election…")),
            if (!_electionLoading && _electionSummary != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_electionSummary!),
                    if (_electionMatched && _nominees.isEmpty)
                      const Padding(padding: EdgeInsets.only(top: 8), child: Text("Nominee names are not stored for this election.")),
                    if (_nominees.isNotEmpty) ...[
                      const Padding(padding: EdgeInsets.only(top: 8), child: Text("Nominated")),
                      for (final person in _nominees) Text(person),
                    ],
                  ],
                ),
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
