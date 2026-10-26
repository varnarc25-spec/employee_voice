import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

class JoinUsAction extends StatelessWidget {
  const JoinUsAction({super.key});

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: () => context.push("/involved"),
      child: const Text("Join us"),
    );
  }
}

class AlertsAction extends StatelessWidget {
  const AlertsAction({super.key});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: () => context.push("/alerts"),
      icon: const Icon(Icons.notifications_outlined),
      tooltip: "Alerts",
    );
  }
}

class NoticeBanner extends StatelessWidget {
  const NoticeBanner(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFFFF8E8),
          border: Border.all(color: const Color(0xFFE2D3A4)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(padding: const EdgeInsets.all(12), child: Text(text)),
      ),
    );
  }
}

class StatusBody extends StatelessWidget {
  const StatusBody({
    super.key,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.child,
    this.empty = false,
    this.emptyText = "Nothing here yet.",
  });

  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  final bool empty;
  final String emptyText;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    if (error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text("Try again")),
          ],
        ),
      );
    }
    if (empty) return Center(child: Text(emptyText, textAlign: TextAlign.center));
    return child;
  }
}
