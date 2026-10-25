import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:go_router/go_router.dart";
import "package:google_sign_in/google_sign_in.dart";

import "../core/app_state.dart";
import "../main.dart";

const _ink = Color(0xFF102B4A);
const _cta = Color(0xFF2F6BFF);
const _canvas = Colors.white;
const _muted = Color(0xFF6B7280);

TextStyle _poppins({double size = 16, FontWeight weight = FontWeight.w400, Color color = _ink, double height = 1.4}) {
  return TextStyle(fontFamily: "Poppins", fontSize: size, fontWeight: weight, color: color, height: height);
}

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height;
    final compact = height < 760;
    final logoSize = compact ? 72.0 : 96.0;
    return Scaffold(
      backgroundColor: _canvas,
      body: SafeArea(
        minimum: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
          child: Column(
            children: [
              const _BrandHeader(),
              SizedBox(height: compact ? 4 : 8),
              Image(image: const AssetImage("assets/brand/logo.png"), height: logoSize, fit: BoxFit.contain, semanticLabel: "Employee Voice India"),
              SizedBox(height: compact ? 6 : 8),
              Text("Your Voice. Your Community.", textAlign: TextAlign.center, style: _poppins(size: compact ? 22 : 24, weight: FontWeight.w700, height: 1.15)),
              const SizedBox(height: 6),
              Text(
                "For taxpaying employees across India. Share concerns, discuss workplace issues, and be heard.",
                textAlign: TextAlign.center,
                style: _poppins(size: 13, color: _muted, height: 1.3),
              ),
              SizedBox(height: compact ? 8 : 12),
              const _FeatureRow(icon: Icons.forum_outlined, title: "Speak openly", detail: "Rights, workplace issues, salaries, and taxation."),
              const _FeatureRow(icon: Icons.how_to_vote_outlined, title: "Make your opinion count", detail: "Polls and views on issues affecting employees."),
              const _FeatureRow(icon: Icons.groups_outlined, title: "United employee voice", detail: "Connect across India and raise common concerns."),
              const _IndependenceNotice(),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: _cta,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    textStyle: _poppins(size: 16, weight: FontWeight.w600, color: Colors.white, height: 1.2),
                  ),
                  onPressed: () => context.go("/sign-in"),
                  child: const Text("Continue to sign in"),
                ),
              ),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _LegalLink(label: "Community Guidelines", onPressed: () => context.push("/legal/guidelines")),
                  Text("·", style: _poppins(size: 13, color: _muted)),
                  _LegalLink(label: "Privacy Policy", onPressed: () => context.push("/legal/privacy")),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Image(image: AssetImage("assets/brand/logo.png"), height: 36, semanticLabel: "Employee Voice India"),
        const SizedBox(width: 10),
        Text("Employee Voice India", style: _poppins(size: 16, weight: FontWeight.w600)),
      ],
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({required this.icon, required this.title, required this.detail});

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: const Color(0x1400778B), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: _cta, size: 20),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: _poppins(size: 14, weight: FontWeight.w600, height: 1.2)),
                Text(detail, style: _poppins(size: 12, color: _muted, height: 1.25)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _IndependenceNotice extends StatelessWidget {
  const _IndependenceNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD5E2EA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Independent employee community", style: _poppins(size: 13, weight: FontWeight.w600, height: 1.2)),
          const SizedBox(height: 2),
          Text(
            "It is not a government service or registered trade union. Participation does not constitute union membership.",
            style: _poppins(size: 12, color: _muted, height: 1.3),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              style: TextButton.styleFrom(foregroundColor: _cta, minimumSize: const Size(48, 36), padding: EdgeInsets.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
              onPressed: () => context.push("/community-notice"),
              child: Text("Read the full notice", style: _poppins(size: 13, weight: FontWeight.w600, color: _cta, height: 1.2)),
            ),
          ),
        ],
      ),
    );
  }
}

class _LegalLink extends StatelessWidget {
  const _LegalLink({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      style: TextButton.styleFrom(foregroundColor: _cta, minimumSize: const Size(48, 40), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
      onPressed: onPressed,
      child: Text(label, style: _poppins(size: 14, weight: FontWeight.w600, color: _cta, height: 1.2)),
    );
  }
}

class CommunityNoticeScreen extends StatelessWidget {
  const CommunityNoticeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _canvas,
      appBar: AppBar(
        backgroundColor: _canvas,
        foregroundColor: _ink,
        title: Text("About this community", style: _poppins(size: 18, weight: FontWeight.w600)),
      ),
      body: SafeArea(
        minimum: const EdgeInsets.only(bottom: 28),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            Text(
              "Employee Voice India is an independent platform for employees in India. It is not a government service or registered trade union. Participation does not constitute union membership.",
              style: _poppins(size: 15, height: 1.5),
            ),
            const SizedBox(height: 16),
            Text(
              "You can discuss workplace issues, vote in polls, and, separately, say whether you want to help form an employee organization later. That interest is optional and can be withdrawn. It is not membership.",
              style: _poppins(size: 15, height: 1.5),
            ),
            const SizedBox(height: 16),
            Text(
              "Peers see a display name. Administrators, moderators, and the people who operate the servers can still access account data when their role requires it. This app does not promise anonymity.",
              style: _poppins(size: 15, height: 1.5),
            ),
            const SizedBox(height: 16),
            Text(
              "Do not post your email, phone number, government identity numbers, or someone else's private information.",
              style: _poppins(size: 15, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}

class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  bool _busy = false;
  String? _message;

  Future<void> _gmail(AppState state) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      const serverClientId = String.fromEnvironment(
        "GOOGLE_SERVER_CLIENT_ID",
        defaultValue: "414895350436-9nlsdp5spkufv1r5egvb81oncrc6u8eo.apps.googleusercontent.com",
      );
      final account = await GoogleSignIn(scopes: const ["email", "profile"], serverClientId: serverClientId).signIn();
      if (account == null) return;
      final idToken = (await account.authentication).idToken;
      if (idToken == null || idToken.isEmpty) {
        if (mounted) setState(() => _message = "Google did not return a sign-in token.");
        return;
      }
      await state.signInWithGoogle(idToken, adult: true, terms: true);
    } on PlatformException catch (error) {
      final cancelled = (error.code).toLowerCase().contains("cancel") || (error.message ?? "").toLowerCase().contains("cancel");
      if (mounted && !cancelled) setState(() => _message = "Sign-in did not finish. Try again.");
    } catch (error) {
      if (mounted) setState(() => _message = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(28),
                boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 28, offset: Offset(0, 10))],
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Image(image: AssetImage("assets/brand/logo.png"), height: 88, fit: BoxFit.contain, semanticLabel: "Employee Voice India"),
                    const SizedBox(height: 20),
                    Text("Login", style: _poppins(size: 32, weight: FontWeight.w700, height: 1.1)),
                    const SizedBox(height: 8),
                    Text("Sign in with your Gmail account.", textAlign: TextAlign.center, style: _poppins(size: 14, color: _muted, height: 1.4)),
                    const SizedBox(height: 28),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: _cta,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          textStyle: _poppins(size: 16, weight: FontWeight.w600, color: Colors.white),
                        ),
                        onPressed: _busy ? null : () => _gmail(state),
                        child: const Text("Continue with Gmail"),
                      ),
                    ),
                    if (_message != null) ...[
                      const SizedBox(height: 12),
                      Text(_message!, textAlign: TextAlign.center, style: _poppins(size: 13, color: const Color(0xFFB42318))),
                    ],
                    const SizedBox(height: 16),
                    Text(
                      "By continuing you confirm you are 18 or older and agree to the terms and privacy notice.",
                      textAlign: TextAlign.center,
                      style: _poppins(size: 12, color: _muted, height: 1.4),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
