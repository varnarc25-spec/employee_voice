# Google Play release checklist

Complete this before uploading a release build. Policy text changes, so read the current Play Console requirements at submission time.

- [ ] Application id and the label `Employee Voice India` are intentional.
- [ ] The store listing says the app is an independent community. It does not say the app is a government service or a registered trade union.
- [ ] Privacy policy URL points at a counsel-reviewed notice, not the draft in `docs/legal/privacy-notice.md`, until that draft is approved.
- [ ] The public account-deletion page is deployed at `https://<api-host>/account/delete` and is linked from the store listing and from inside the app.
- [ ] In-app deletion asks the member to type `delete my account` and calls `POST /api/v1/me/privacy-requests`.
- [ ] Release builds use HTTPS. The debug manifest's cleartext exception is not in the release manifest.
- [ ] No `google-services.json` is committed. FCM is optional and unsigned until a Firebase project exists.
- [ ] The Data safety form matches the privacy matrix: email, optional profile fields, user-generated content, and optional push token. No advertising id, contacts, or precise location.
- [ ] A content rating questionnaire is completed for user-generated discussion.
- [ ] Moderation, reporting, and the appeal path in `docs/legal/report-appeal.md` are described in the listing where Play asks about user-generated content.
- [ ] Signing uses a Play App Signing key that is not in the repository.
- [ ] `flutter build appbundle --dart-define=API_BASE_URL=https://<api-host>` points at production.

Target the API from a release build:

```bash
cd mobile
flutter build appbundle --dart-define=API_BASE_URL=https://api.example.com
```
