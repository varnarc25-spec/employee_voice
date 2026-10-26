import "package:flutter/material.dart";

import "../core/api_client.dart";
import "../core/widgets.dart";
import "../main.dart";

class PollsScreen extends StatefulWidget {
  const PollsScreen({super.key});

  @override
  State<PollsScreen> createState() => _PollsScreenState();
}

class _PollsScreenState extends State<PollsScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _items = [];

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
      final body = await state.client.get("/api/v1/polls", bearer: state.access);
      if (mounted) setState(() => _items = (body["items"] as List? ?? []).cast<Map<String, dynamic>>());
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _vote(String pollId, String optionId) async {
    final state = AppScope.of(context);
    try {
      await state.client.post("/api/v1/polls/$pollId/votes", {"optionId": optionId}, bearer: state.access);
      await _load();
    } on ApiException catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Poll"), actions: const [JoinUsAction(), AlertsAction()]),
      body: StatusBody(
        loading: _loading,
        error: _error,
        onRetry: _load,
        empty: _items.isEmpty,
        emptyText: "No polls are open.",
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const NoticeBanner("Results stay hidden until a poll closes and at least five people have voted. A vote is stored separately from the member who cast it, but this is not cryptographic anonymity."),
            for (final poll in _items) _PollCard(poll: poll, onVote: _vote),
          ],
        ),
      ),
    );
  }
}

class _PollCard extends StatelessWidget {
  const _PollCard({required this.poll, required this.onVote});
  final Map<String, dynamic> poll;
  final Future<void> Function(String pollId, String optionId) onVote;

  @override
  Widget build(BuildContext context) {
    final options = (poll["options"] as List? ?? []).cast<Map<String, dynamic>>();
    final visible = poll["resultsVisible"] == true;
    final closed = poll["status"] == "closed";
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(poll["question"] as String? ?? "", style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(poll["resultsNote"] as String? ?? ""),
            if (visible)
              for (final option in options)
                Text("${option["label"]}: ${option["votes"] ?? 0}")
            else
              for (final option in options)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: OutlinedButton(
                    onPressed: closed || poll["viewerHasVoted"] == true ? null : () => onVote(poll["id"] as String, option["id"] as String),
                    child: Text(option["label"] as String? ?? "Option"),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}
