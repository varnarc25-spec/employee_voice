import "package:flutter/material.dart";
import "package:go_router/go_router.dart";
import "package:url_launcher/url_launcher.dart";

import "../core/api_client.dart";
import "../core/rules.dart";
import "../core/widgets.dart";
import "../main.dart";

const postCategories = <(String, String)>[
  ("salary", "Salary"),
  ("layoffs", "Layoffs"),
  ("workingHours", "Working hours"),
  ("careerGrowth", "Career growth"),
  ("workplaceTreatment", "Workplace treatment"),
  ("benefits", "Benefits"),
  ("employeeRights", "Employee rights"),
];

class FeedScreen extends StatefulWidget {
  const FeedScreen({super.key});

  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends State<FeedScreen> {
  String? _category;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _items = [];
  String? _schemeLabel;
  String? _schemeUrl;
  List<Map<String, dynamic>> _logos = [];

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
      final query = _category == null ? "" : "?category=$_category";
      final body = await state.client.get("/api/v1/posts$query", bearer: state.access);
      final items = (body["items"] as List? ?? []).cast<Map<String, dynamic>>();
      String? schemeLabel;
      String? schemeUrl;
      try {
        final scheme = await state.client.get("/api/v1/me/scheme-link", bearer: state.access);
        final stateName = scheme["stateName"] as String?;
        schemeUrl = scheme["url"] as String?;
        schemeLabel = stateName == null || stateName.isEmpty ? "Government schemes" : "Schemes for $stateName";
      } catch (_) {
        schemeLabel = null;
        schemeUrl = null;
      }
      List<Map<String, dynamic>> logos = [];
      try {
        final logoBody = await state.client.get("/api/v1/portal-logos", bearer: state.access);
        logos = (logoBody["items"] as List? ?? []).cast<Map<String, dynamic>>();
      } catch (_) {
        logos = [];
      }
      if (mounted) {
        setState(() {
          _items = items;
          _schemeLabel = schemeLabel;
          _schemeUrl = schemeUrl;
          _logos = logos;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Image(image: AssetImage("assets/brand/logo.png"), height: 40, fit: BoxFit.contain, semanticLabel: "Employee Voice India"),
        actions: [IconButton(onPressed: () => context.go("/guidelines"), icon: const Icon(Icons.menu_book_outlined), tooltip: "Guidelines")],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push("/compose").then((_) => _load()),
        label: const Text("New post"),
        icon: const Icon(Icons.edit_outlined),
      ),
      body: Column(
        children: [
          const Padding(padding: EdgeInsets.fromLTRB(16, 12, 16, 0), child: NoticeBanner("Peers see your display name. Moderators and server operators can still access account data.")),
          if (_logos.isNotEmpty)
            SizedBox(
              height: 64,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                itemCount: _logos.length,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final logo = _logos[index];
                  final imageUrl = logo["imageUrl"] as String? ?? "";
                  final link = logo["linkUrl"] as String?;
                  return Material(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(8),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: link == null ? null : () => launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Image.network(
                          "${AppScope.of(context).client.baseUrl}$imageUrl",
                          height: 40,
                          fit: BoxFit.contain,
                          semanticLabel: logo["altText"] as String? ?? logo["title"] as String? ?? "Portal logo",
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Material(
              color: const Color(0xFFEEF3F7),
              borderRadius: BorderRadius.circular(8),
              child: InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => context.push("/explore"),
                child: const Padding(
                  padding: EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Icon(Icons.travel_explore_outlined),
                      SizedBox(width: 12),
                      Expanded(child: Text("Explore India")),
                      Icon(Icons.chevron_right),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (_schemeLabel != null && _schemeUrl != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
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
                        Expanded(child: Text(_schemeLabel!)),
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
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(label: const Text("All"), selected: _category == null, onSelected: (_) => setState(() { _category = null; _load(); })),
                ),
                for (final category in postCategories)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      label: Text(category.$2),
                      selected: _category == category.$1,
                      onSelected: (_) => setState(() { _category = category.$1; _load(); }),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: StatusBody(
              loading: _loading,
              error: _error,
              onRetry: _load,
              empty: _items.isEmpty,
              emptyText: "No posts in this category yet.",
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: _items.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final post = _items[index];
                  return Card(
                    child: ListTile(
                      title: Text(post["title"] as String? ?? ""),
                      subtitle: Text("${post["category"]} · ${post["authorDisplayName"] ?? "Member"}"),
                      onTap: () => context.push("/posts/${post["id"]}"),
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

class ComposeScreen extends StatefulWidget {
  const ComposeScreen({super.key, this.postId});
  final String? postId;

  @override
  State<ComposeScreen> createState() => _ComposeScreenState();
}

class _ComposeScreenState extends State<ComposeScreen> {
  final _form = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _body = TextEditingController();
  String _category = "salary";
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final state = AppScope.of(context);
    setState(() => _busy = true);
    try {
      final payload = {"title": _title.text.trim(), "body": _body.text.trim(), "category": _category};
      if (widget.postId == null) {
        await state.client.post("/api/v1/posts", payload, bearer: state.access);
      } else {
        await state.client.put("/api/v1/posts/${widget.postId}", payload, bearer: state.access);
      }
      if (mounted) context.pop();
    } on ApiException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.postId == null ? "New post" : "Edit post")),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(labelText: "Category", border: OutlineInputBorder()),
              items: [for (final category in postCategories) DropdownMenuItem(value: category.$1, child: Text(category.$2))],
              onChanged: (value) => setState(() => _category = value ?? _category),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _title,
              decoration: const InputDecoration(labelText: "Title", border: OutlineInputBorder()),
              validator: (value) => FormRules.postTitle(value ?? ""),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _body,
              minLines: 6,
              maxLines: 12,
              decoration: const InputDecoration(labelText: "What happened", border: OutlineInputBorder()),
              validator: (value) => FormRules.postBody(value ?? ""),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _busy ? null : _save, child: const Text("Publish")),
          ],
        ),
      ),
    );
  }
}

class PostScreen extends StatefulWidget {
  const PostScreen({super.key, required this.postId});
  final String postId;

  @override
  State<PostScreen> createState() => _PostScreenState();
}

class _PostScreenState extends State<PostScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _post;
  List<Map<String, dynamic>> _comments = [];
  final _comment = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final state = AppScope.of(context);
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final post = await state.client.get("/api/v1/posts/${widget.postId}", bearer: state.access);
      final comments = await state.client.get("/api/v1/posts/${widget.postId}/comments", bearer: state.access);
      if (mounted) {
        setState(() {
          _post = post;
          _comments = (comments["items"] as List? ?? []).cast<Map<String, dynamic>>();
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _react() async {
    final state = AppScope.of(context);
    await state.client.post("/api/v1/posts/${widget.postId}/support", null, bearer: state.access);
    await _load();
  }

  Future<void> _commentSend() async {
    if (FormRules.postBody(_comment.text) != null) return;
    final state = AppScope.of(context);
    await state.client.post("/api/v1/posts/${widget.postId}/comments", {"body": _comment.text.trim()}, bearer: state.access);
    _comment.clear();
    await _load();
  }

  Future<void> _block() async {
    final author = _post?["authorId"] as String?;
    if (author == null) return;
    final state = AppScope.of(context);
    await state.client.post("/api/v1/blocks", {"userId": author}, bearer: state.access);
    if (mounted) context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final post = _post;
    return Scaffold(
      appBar: AppBar(
        title: const Text("Post"),
        actions: [
          if (post != null)
            IconButton(
              tooltip: "Report",
              icon: const Icon(Icons.flag_outlined),
              onPressed: () => context.push("/report/post/${widget.postId}"),
            ),
          if (post != null) IconButton(tooltip: "Block author", icon: const Icon(Icons.block), onPressed: _block),
        ],
      ),
      body: StatusBody(
        loading: _loading,
        error: _error,
        onRetry: _load,
        child: post == null
            ? const SizedBox.shrink()
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(post["title"] as String? ?? "", style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text("${post["category"]} · ${post["authorDisplayName"] ?? "Member"}"),
                  const SizedBox(height: 12),
                  Text(post["body"] as String? ?? ""),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _react, child: Text("Support · ${post["supportCount"] ?? 0}")),
                  const Divider(height: 32),
                  for (final comment in _comments)
                    ListTile(
                      title: Text(comment["body"] as String? ?? ""),
                      subtitle: Text(comment["authorDisplayName"] as String? ?? "Member"),
                      trailing: IconButton(
                        tooltip: "Report comment",
                        icon: const Icon(Icons.flag_outlined),
                        onPressed: () => context.push("/report/comment/${comment["id"]}"),
                      ),
                    ),
                  TextField(
                    controller: _comment,
                    minLines: 2,
                    maxLines: 4,
                    decoration: const InputDecoration(labelText: "Comment", border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 8),
                  FilledButton(onPressed: _commentSend, child: const Text("Add comment")),
                ],
              ),
      ),
    );
  }
}

class ReportScreen extends StatefulWidget {
  const ReportScreen({super.key, required this.kind, required this.targetId});
  final String kind;
  final String targetId;

  @override
  State<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends State<ReportScreen> {
  String _reason = "harassment";
  final _details = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final state = AppScope.of(context);
    setState(() => _busy = true);
    try {
      await state.client.post("/api/v1/reports", {
        "targetType": widget.kind,
        "targetId": widget.targetId,
        "reason": _reason,
        "details": _details.text.trim(),
      }, bearer: state.access);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Report submitted.")));
        context.pop();
      }
    } on ApiException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Report")),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          DropdownButtonFormField<String>(
            initialValue: _reason,
            decoration: const InputDecoration(labelText: "Reason", border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: "harassment", child: Text("Harassment")),
              DropdownMenuItem(value: "personalData", child: Text("Personal data")),
              DropdownMenuItem(value: "spam", child: Text("Spam")),
              DropdownMenuItem(value: "other", child: Text("Other")),
            ],
            onChanged: (value) => setState(() => _reason = value ?? _reason),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _details,
            minLines: 3,
            maxLines: 6,
            decoration: const InputDecoration(labelText: "What should a moderator know?", border: OutlineInputBorder()),
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _send, child: const Text("Submit report")),
        ],
      ),
    );
  }
}
