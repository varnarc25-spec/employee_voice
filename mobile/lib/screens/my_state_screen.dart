import "package:flutter/material.dart";
import "package:go_router/go_router.dart";
import "package:url_launcher/url_launcher.dart";

import "../core/widgets.dart";
import "../main.dart";
import "explore_screen.dart";

class MyStateScreen extends StatefulWidget {
  const MyStateScreen({super.key});

  @override
  State<MyStateScreen> createState() => _MyStateScreenState();
}

class _MyStateScreenState extends State<MyStateScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _dashboard;

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
      final body = await state.client.get("/api/v1/me/state-dashboard", bearer: state.access);
      if (mounted) setState(() => _dashboard = body);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickState() async {
    final app = AppScope.of(context);
    final rows = await app.client.get("/api/v1/locations/states", bearer: app.access);
    final states = (rows["items"] as List? ?? []).cast<Map<String, dynamic>>();
    if (!mounted) return;
    final chosen = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        builder: (context, controller) => ListView(
          controller: controller,
          children: [
            const ListTile(title: Text("Choose your state")),
            for (final item in states)
              ListTile(
                title: Text(item["nameEn"] as String? ?? ""),
                onTap: () => Navigator.pop(context, item["lgdCode"] as int),
              ),
          ],
        ),
      ),
    );
    if (chosen == null || !mounted) return;
    await app.client.post("/api/v1/me/home-state", {"stateLgdCode": chosen}, bearer: app.access);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final state = _dashboard?["state"] as Map<String, dynamic>?;
    final counts = _dashboard?["counts"] as Map<String, dynamic>? ?? {};
    final government = _dashboard?["government"] as Map<String, dynamic>?;
    final election = _dashboard?["latestElection"] as Map<String, dynamic>?;
    final parties = (election?["parties"] as List? ?? []).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: AppBar(
        title: const Text("My state"),
        actions: [
          IconButton(onPressed: _pickState, icon: const Icon(Icons.swap_horiz), tooltip: "Change state"),
          IconButton(onPressed: () => context.push("/explore"), icon: const Icon(Icons.search), tooltip: "Explore India"),
          const AlertsAction(),
        ],
      ),
      body: StatusBody(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: state == null
            ? ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const NoticeBanner("Choose the state you want to follow. The app does not use your device location."),
                  FilledButton(onPressed: _pickState, child: const Text("Choose a state")),
                ],
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(state["name"] as String? ?? "", style: Theme.of(context).textTheme.headlineSmall),
                    Text("${state["kind"]} · India"),
                    const SizedBox(height: 16),
                    Text("State government", style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Card(
                      child: ListTile(
                        title: Text(government?["headName"] as String? ?? "No reviewed government record"),
                        subtitle: Text([
                          government?["headTitle"],
                          government?["coalitionName"],
                        ].whereType<String>().where((part) => part.isNotEmpty).join(" · ")),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        _Stat("${counts["assemblySeats"] ?? 0}", "Assembly seats on file"),
                        _Stat("${counts["lokSabhaSeats"] ?? 0}", "Lok Sabha seats"),
                        _Stat(election?["termYears"] == null ? "—" : "${election!["termYears"]} years", "Assembly term"),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text("Explore your state", style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    GridView.count(
                      crossAxisCount: 4,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      children: [
                        _Tile(Icons.how_to_vote_outlined, "Elections", () => _section("Elections", election == null ? "No published election summary for this state." : election["name"] as String)),
                        _Tile(Icons.flag_outlined, "Parties", () => _section("Parties", parties.isEmpty ? "No published party seat list for this state." : parties.map((row) => "${row["abbreviation"] ?? row["name"]}: ${row["seats"]}").join("\n"))),
                        _Tile(Icons.menu_book_outlined, "Manifestos", () => _section("Manifestos", "No published manifesto is on file.")),
                        _Tile(Icons.card_giftcard_outlined, "Benefits", () => _openScheme()),
                        _Tile(Icons.account_balance_outlined, "Schemes", () => _openScheme()),
                        _Tile(Icons.bar_chart_outlined, "Budget", () => _section("Budget", "No published budget figure is on file.")),
                        _Tile(Icons.groups_outlined, "Leaders", () => _section("Leaders", government?["headName"] as String? ?? "No reviewed leader is on file.")),
                        _Tile(Icons.map_outlined, "Districts", () => _section("Districts", "${counts["districts"] ?? 0} districts are on the LGD list.")),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text("Latest election results", style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (election == null || parties.isEmpty)
                      const Card(child: ListTile(title: Text("No published seat totals"), subtitle: Text("Results appear here after a sourced record is reviewed.")))
                    else
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text("${election["name"]} · ${election["year"]}"),
                              const SizedBox(height: 8),
                              for (final row in parties) Text("${row["abbreviation"] ?? row["name"]} · ${row["seats"]} seats"),
                            ],
                          ),
                        ),
                      ),
                    const SizedBox(height: 16),
                    Text("Discover ${state["name"]}", style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        ActionChip(label: Text("Places (${counts["places"] ?? 0})"), onPressed: () => _openExplore("places")),
                        ActionChip(label: Text("Food (${counts["dishes"] ?? 0})"), onPressed: () => _openExplore("dishes")),
                        ActionChip(label: Text("Products (${counts["products"] ?? 0})"), onPressed: () => _openExplore("products")),
                        ActionChip(label: const Text("Facts"), onPressed: () => _openExplore("facts")),
                      ],
                    ),
                  ],
                ),
              ),
      ),
    );
  }

  void _openExplore(String section) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ExploreScreen(mine: true, initialSection: section)));
  }

  Future<void> _openScheme() async {
    final url = _dashboard?["schemeUrl"] as String?;
    if (url == null) {
      _section("Schemes", "No official scheme link is stored for this state.");
      return;
    }
    await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }

  void _section(String title, String body) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: Padding(padding: const EdgeInsets.all(16), child: Text(body)),
      ),
    ));
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.value, this.label);
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(value, style: Theme.of(context).textTheme.titleLarge),
          Text(label, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon),
          const SizedBox(height: 4),
          Text(label, textAlign: TextAlign.center, style: Theme.of(context).textTheme.labelSmall),
        ],
      ),
    );
  }
}
