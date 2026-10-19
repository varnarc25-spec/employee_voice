import "dart:convert";
import "dart:math";

import "package:crypto/crypto.dart";
import "package:flutter/foundation.dart";
import "package:flutter/material.dart";
import "package:flutter_web_auth_2/flutter_web_auth_2.dart";
import "package:go_router/go_router.dart";
import "package:google_sign_in/google_sign_in.dart";

import "../core/app_state.dart";
import "../core/rules.dart";
import "../main.dart";

const _ink = Color(0xFF102B4A);
const _cta = Color(0xFF00778B);
const _canvas = Color(0xFFF6F9FC);
const _muted = Color(0xFF34506A);

TextStyle _poppins({double size = 16, FontWeight weight = FontWeight.w400, Color color = _ink, double height = 1.4}) {
  return TextStyle(fontFamily: "Poppins", fontSize: size, fontWeight: weight, color: color, height: height);
}

class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final logoSize = (MediaQuery.sizeOf(context).width * 0.42).clamp(148.0, 200.0);
    return Scaffold(
      backgroundColor: _canvas,
      body: SafeArea(
        minimum: const EdgeInsets.only(bottom: 28),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            const _BrandHeader(),
            const SizedBox(height: 12),
            Center(
              child: Image(
                image: const AssetImage("assets/brand/logo.png"),
                height: logoSize,
                fit: BoxFit.contain,
                semanticLabel: "Employee Voice India",
              ),
            ),
            const SizedBox(height: 16),
            Text("Your Voice. Your Community.", textAlign: TextAlign.center, style: _poppins(size: 26, weight: FontWeight.w700, height: 1.2)),
            const SizedBox(height: 10),
            Text(
              "A platform for taxpaying employees across India to share concerns, discuss workplace issues, understand policies that affect them, and make their voices heard.",
              textAlign: TextAlign.center,
              style: _poppins(size: 15, color: _muted, height: 1.45),
            ),
            const SizedBox(height: 22),
            const _FeatureRow(icon: Icons.forum_outlined, title: "Speak openly", detail: "Discuss employee rights, workplace challenges, salaries, and taxation."),
            const _FeatureRow(icon: Icons.how_to_vote_outlined, title: "Make your opinion count", detail: "Participate in polls and share views on issues affecting employees."),
            const _FeatureRow(icon: Icons.groups_outlined, title: "United employee voice", detail: "Connect with fellow employees across India and raise common concerns."),
            const SizedBox(height: 8),
            const _IndependenceNotice(),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 52,
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
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.center,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _LegalLink(label: "Community Guidelines", onPressed: () => context.push("/legal/guidelines")),
                Text("·", style: _poppins(color: _muted)),
                _LegalLink(label: "Privacy Policy", onPressed: () => context.push("/legal/privacy")),
              ],
            ),
          ],
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
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(color: const Color(0x1400778B), borderRadius: BorderRadius.circular(12)),
            child: Icon(icon, color: _cta),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: _poppins(size: 16, weight: FontWeight.w600, height: 1.25)),
                const SizedBox(height: 2),
                Text(detail, style: _poppins(size: 14, color: _muted, height: 1.35)),
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
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD5E2EA)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text("Independent employee community", style: _poppins(size: 15, weight: FontWeight.w600, height: 1.3)),
          const SizedBox(height: 6),
          Text(
            "Employee Voice India is an independent platform for employees in India. It is not a government service or registered trade union. Participation does not constitute union membership.",
            style: _poppins(size: 13, color: _muted, height: 1.45),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              style: TextButton.styleFrom(foregroundColor: _cta, minimumSize: const Size(48, 48), padding: const EdgeInsets.symmetric(horizontal: 0)),
              onPressed: () => context.push("/community-notice"),
              child: Text("Read the full notice", style: _poppins(size: 14, weight: FontWeight.w600, color: _cta, height: 1.2)),
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
      style: TextButton.styleFrom(foregroundColor: _cta, minimumSize: const Size(48, 48)),
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
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _adult = false;
  bool _terms = false;
  bool _busy = false;
  String? _message;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  bool _consent() {
    if (_adult && _terms) return true;
    setState(() => _message = "Confirm that you are 18 or older and that you agree to the draft terms.");
    return false;
  }

  Future<void> _send(AppState state) async {
    if (!_consent() || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final message = await state.sendPhoneCode(_phone.text, adult: _adult, terms: _terms);
      if (mounted) setState(() => _message = message);
    } catch (error) {
      if (mounted) setState(() => _message = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify(AppState state) async {
    if (!_consent()) return;
    if ((_code.text.trim().length) < 4) {
      setState(() => _message = "Enter the code from the text message.");
      return;
    }
    setState(() => _busy = true);
    try {
      await state.verifyPhoneCode(_phone.text, _code.text, adult: _adult, terms: _terms);
    } catch (error) {
      if (mounted) setState(() => _message = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _developmentCode(AppState state) async {
    setState(() => _busy = true);
    try {
      final code = await state.developmentPhoneCode();
      if (mounted) {
        _code.text = code ?? "";
        setState(() => _message = code == null ? "No development code is waiting." : "Loaded the local development code.");
      }
    } catch (error) {
      if (mounted) setState(() => _message = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _google(AppState state) async {
    if (!_consent()) return;
    const serverClientId = String.fromEnvironment("GOOGLE_SERVER_CLIENT_ID");
    if (serverClientId.isEmpty) {
      setState(() => _message = "Google sign-in needs GOOGLE_SERVER_CLIENT_ID. See the README.");
      return;
    }
    setState(() => _busy = true);
    try {
      final account = await GoogleSignIn(serverClientId: serverClientId, scopes: const ["email"]).signIn();
      final idToken = (await account?.authentication)?.idToken;
      if (idToken == null) {
        if (mounted) setState(() => _message = "Google did not return a sign-in token.");
        return;
      }
      await state.signInWithGoogle(idToken, adult: _adult, terms: _terms);
    } catch (error) {
      if (mounted) setState(() => _message = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _linkedin(AppState state) async {
    if (!_consent()) return;
    const clientId = String.fromEnvironment("LINKEDIN_CLIENT_ID");
    const redirectUri = String.fromEnvironment("LINKEDIN_REDIRECT_URI", defaultValue: "http://localhost:5080/auth/linkedin/callback");
    if (clientId.isEmpty) {
      setState(() => _message = "LinkedIn sign-in needs LINKEDIN_CLIENT_ID. See the README.");
      return;
    }
    setState(() => _busy = true);
    try {
      final verifier = _verifier();
      final stateValue = _verifier();
      final challenge = base64Url.encode(sha256.convert(utf8.encode(verifier)).bytes).replaceAll("=", "");
      final url = Uri.https("www.linkedin.com", "/oauth/v2/authorization", {
        "response_type": "code",
        "client_id": clientId,
        "redirect_uri": redirectUri,
        "scope": "openid profile email",
        "state": stateValue,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
      });
      final result = await FlutterWebAuth2.authenticate(url: url.toString(), callbackUrlScheme: "employeevoice");
      final returned = Uri.parse(result);
      if (returned.queryParameters["state"] != stateValue) {
        if (mounted) setState(() => _message = "LinkedIn returned an unexpected response.");
        return;
      }
      final error = returned.queryParameters["error"];
      if (error != null && error.isNotEmpty) {
        if (mounted) setState(() => _message = "LinkedIn did not complete sign-in.");
        return;
      }
      final code = returned.queryParameters["code"] ?? "";
      await state.signInWithLinkedIn(code, verifier, adult: _adult, terms: _terms);
    } catch (error) {
      if (mounted) setState(() => _message = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _verifier() {
    final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
    return base64Url.encode(bytes).replaceAll("=", "");
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text("Sign in")),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const Image(image: AssetImage("assets/brand/logo.png"), height: 160, fit: BoxFit.contain, semanticLabel: "Employee Voice India"),
            const SizedBox(height: 16),
            const Text("Sign in with your mobile number, Google, or LinkedIn. There is no password. Signing in does not verify employment."),
            const SizedBox(height: 12),
            CheckboxListTile(
              value: _adult,
              onChanged: _busy ? null : (value) => setState(() => _adult = value ?? false),
              title: const Text("I am 18 or older"),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            CheckboxListTile(
              value: _terms,
              onChanged: _busy ? null : (value) => setState(() => _terms = value ?? false),
              title: const Text("I agree to the draft terms and privacy notice"),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: "Indian mobile number", border: OutlineInputBorder()),
              validator: (value) => FormRules.indianMobile(value ?? ""),
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: _busy ? null : () => _send(state), child: const Text("Send code")),
            const SizedBox(height: 12),
            TextFormField(
              controller: _code,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: "Text message code", border: OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: _busy ? null : () => _verify(state), child: const Text("Continue")),
            if (kDebugMode) ...[
              const SizedBox(height: 8),
              TextButton(onPressed: _busy ? null : () => _developmentCode(state), child: const Text("Load development code")),
            ],
            const SizedBox(height: 24),
            OutlinedButton(onPressed: _busy ? null : () => _google(state), child: const Text("Continue with Google")),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: _busy ? null : () => _linkedin(state), child: const Text("Continue with LinkedIn")),
            if (_message != null) ...[const SizedBox(height: 12), Text(_message!)],
          ],
        ),
      ),
    );
  }
}
