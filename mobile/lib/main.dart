import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

import "core/app_state.dart";
import "screens/account_screens.dart";
import "screens/auth_screens.dart";
import "screens/explore_screen.dart";
import "screens/feed_screens.dart";
import "screens/involved_screen.dart";
import "screens/polls_screen.dart";

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({required AppState state, required super.child, super.key}) : super(notifier: state);

  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

void main() {
  runApp(EmployeeVoiceApp(state: AppState()));
}

class EmployeeVoiceApp extends StatefulWidget {
  const EmployeeVoiceApp({super.key, required this.state});
  final AppState state;

  @override
  State<EmployeeVoiceApp> createState() => _EmployeeVoiceAppState();
}

class _EmployeeVoiceAppState extends State<EmployeeVoiceApp> {
  late final GoRouter _router = GoRouter(
    initialLocation: "/welcome",
    refreshListenable: widget.state,
    redirect: (context, route) {
      if (!widget.state.ready) return null;
      final location = route.matchedLocation;
      final guestEntry = location == "/welcome" || location == "/sign-in";
      final publicInfo = location == "/community-notice" || location.startsWith("/legal/");
      if (!widget.state.signedIn && !guestEntry && !publicInfo) return "/sign-in";
      if (widget.state.signedIn && guestEntry) return "/feed";
      return null;
    },
    routes: [
      GoRoute(path: "/welcome", builder: (context, state) => const WelcomeScreen()),
      GoRoute(path: "/sign-in", builder: (context, state) => const SignInScreen()),
      GoRoute(path: "/community-notice", builder: (context, state) => const CommunityNoticeScreen()),
      GoRoute(
        path: "/legal/:slug",
        builder: (context, state) => GuidelinesScreen(initialSlug: state.pathParameters["slug"] ?? "guidelines"),
      ),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(path: "/feed", builder: (context, state) => const FeedScreen()),
          GoRoute(path: "/explore", builder: (context, state) => const ExploreScreen()),
          GoRoute(path: "/compose", builder: (context, state) => const ComposeScreen()),
          GoRoute(
            path: "/posts/:id",
            builder: (context, state) => PostScreen(postId: state.pathParameters["id"]!),
          ),
          GoRoute(path: "/polls", builder: (context, state) => const PollsScreen()),
          GoRoute(path: "/involved", builder: (context, state) => const InvolvedScreen()),
          GoRoute(path: "/alerts", builder: (context, state) => const AlertsScreen()),
          GoRoute(path: "/profile", builder: (context, state) => const ProfileScreen()),
          GoRoute(path: "/verification", builder: (context, state) => const VerificationScreen()),
          GoRoute(path: "/guidelines", builder: (context, state) => const GuidelinesScreen()),
          GoRoute(
            path: "/report/:kind/:id",
            builder: (context, state) => ReportScreen(kind: state.pathParameters["kind"]!, targetId: state.pathParameters["id"]!),
          ),
        ],
      ),
    ],
  );

  @override
  void initState() {
    super.initState();
    widget.state.bootstrap();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: widget.state,
      child: MaterialApp.router(
        title: "Employee Voice India",
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2F6BFF), brightness: Brightness.light).copyWith(surface: Colors.white),
          scaffoldBackgroundColor: Colors.white,
          appBarTheme: const AppBarTheme(backgroundColor: Colors.white, surfaceTintColor: Colors.white, elevation: 0),
          navigationBarTheme: const NavigationBarThemeData(backgroundColor: Colors.white, surfaceTintColor: Colors.white),
          useMaterial3: true,
          filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(48, 48))),
        ),
        routerConfig: _router,
      ),
    );
  }
}

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.child});
  final Widget child;

  int _index(String location) {
    if (location.startsWith("/polls")) return 1;
    if (location.startsWith("/involved")) return 2;
    if (location.startsWith("/alerts")) return 3;
    if (location.startsWith("/profile") || location.startsWith("/verification")) return 4;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    final index = _index(location);
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) {
          const paths = ["/feed", "/polls", "/involved", "/alerts", "/profile"];
          context.go(paths[value]);
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.forum_outlined), label: "Feed"),
          NavigationDestination(icon: Icon(Icons.how_to_vote_outlined), label: "Polls"),
          NavigationDestination(icon: Icon(Icons.volunteer_activism_outlined), label: "Get involved"),
          NavigationDestination(icon: Icon(Icons.notifications_outlined), label: "Alerts"),
          NavigationDestination(icon: Icon(Icons.person_outline), label: "Profile"),
        ],
      ),
    );
  }
}
