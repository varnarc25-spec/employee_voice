import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../core/widgets.dart";
import "../main.dart";

const _sections = <(String, String)>[
  ("places", "Places"),
  ("dishes", "Food"),
  ("products", "Products"),
  ("facts", "Facts"),
];

class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key, this.mine = false, this.initialQuery = "", this.initialSection = "places"});

  final bool mine;
  final String initialQuery;
  final String initialSection;

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> {
  late String _section = widget.initialSection;
  bool _allStates = false;
  bool _loading = true;
  String? _error;
  String? _stateName;
  String? _schemeUrl;
  int _total = 0;
  List<Map<String, dynamic>> _items = [];
  late final _search = TextEditingController(text: widget.initialQuery);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final state = AppScope.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = Uri(path: "/api/v1/me/explore", queryParameters: {
        "section": _section,
        if (_allStates && !widget.mine) "scope": "all",
        if (_search.text.trim().isNotEmpty) "q": _search.text.trim(),
        "limit": "50",
      }).query;
      final body = await state.client.get("/api/v1/me/explore?$query", bearer: state.access);
      String? schemeUrl;
      if (widget.mine) {
        try {
          final scheme = await state.client.get("/api/v1/me/scheme-link", bearer: state.access);
          schemeUrl = scheme["url"] as String?;
        } catch (_) {
          schemeUrl = null;
        }
      }
      if (!mounted) return;
      setState(() {
        _stateName = body["stateName"] as String?;
        _schemeUrl = schemeUrl;
        _total = body["total"] as int? ?? 0;
        _items = (body["items"] as List? ?? []).cast<Map<String, dynamic>>();
      });
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final stateLabel = _stateName == null || _stateName!.isEmpty ? "My state" : _stateName!;
    final heading = widget.mine
        ? "My state"
        : _section == "facts" || _stateName == null || _stateName!.isEmpty
            ? "Explore India"
            : "Explore $_stateName";
    return Scaffold(
      appBar: AppBar(
        title: Text(heading),
        actions: widget.mine ? const [JoinUsAction(), AlertsAction()] : null,
      ),
      body: Column(
        children: [
          if (widget.mine && _schemeUrl != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Material(
                color: const Color(0xFFEEF3F7),
                borderRadius: BorderRadius.circular(8),
                child: InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () => launchUrl(Uri.parse(_schemeUrl!), mode: LaunchMode.externalApplication),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        const Icon(Icons.account_balance_outlined),
                        const SizedBox(width: 12),
                        Expanded(child: Text("Schemes for $stateLabel")),
                        const Icon(Icons.open_in_new, size: 18),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                for (final section in _sections)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text(section.$2),
                      selected: _section == section.$1,
                      onSelected: (_) => setState(() {
                        _section = section.$1;
                        _load();
                      }),
                    ),
                  ),
                if (_section != "facts" && !widget.mine)
                  FilterChip(
                    label: const Text("All states"),
                    selected: _allStates,
                    onSelected: (_) => setState(() {
                      _allStates = !_allStates;
                      _load();
                    }),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              controller: _search,
              decoration: const InputDecoration(hintText: "Search", prefixIcon: Icon(Icons.search)),
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _load(),
            ),
          ),
          Expanded(
            child: StatusBody(
              loading: _loading,
              error: _error,
              onRetry: _load,
              empty: _items.isEmpty,
              emptyText: "Nothing matches.",
              child: ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                itemCount: _items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final item = _items[index];
                  final page = item["pageUrl"] as String?;
                  final image = item["imageUrl"] as String?;
                  return Card(
                    child: ListTile(
                      leading: image == null || image.isEmpty
                          ? const Icon(Icons.place_outlined)
                          : ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: Image.network(image, width: 56, height: 56, fit: BoxFit.cover),
                            ),
                      title: Text(item["title"] as String? ?? ""),
                      subtitle: Text([
                        item["subtitle"] as String? ?? "",
                        if (_items.length == index + 1 && _total > _items.length) "$_total in this list",
                      ].where((part) => part.isNotEmpty).join("\n")),
                      trailing: page == null ? null : const Icon(Icons.open_in_new, size: 18),
                      onTap: page == null ? null : () => launchUrl(Uri.parse(page), mode: LaunchMode.externalApplication),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
