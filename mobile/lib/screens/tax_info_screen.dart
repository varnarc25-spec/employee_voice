import "package:flutter/material.dart";
import "package:url_launcher/url_launcher.dart";

import "../core/widgets.dart";

class TaxInfoScreen extends StatelessWidget {
  const TaxInfoScreen({super.key});

  static const _links = <(String, String, String)>[
    ("Income Tax e-filing", "Returns, AIS, and Form 26AS for salaried taxpayers.", "https://www.incometax.gov.in/iec/foportal/"),
    ("Income Tax India", "Acts, rules, and taxpayer information from the department.", "https://incometaxindia.gov.in/"),
    ("TRACES", "TDS statements and Form 16 downloads for deductors and taxpayers.", "https://www.tdscpc.gov.in/"),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Tax Info"), actions: const [JoinUsAction(), AlertsAction()]),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const NoticeBanner("These open official government sites. This app does not calculate tax, file a return, or store tax documents."),
          for (final link in _links)
            Card(
              child: ListTile(
                title: Text(link.$1),
                subtitle: Text(link.$2),
                trailing: const Icon(Icons.open_in_new, size: 18),
                onTap: () => launchUrl(Uri.parse(link.$3), mode: LaunchMode.externalApplication),
              ),
            ),
        ],
      ),
    );
  }
}
