namespace EmployeeVoice.Api.Infrastructure;

public static class LegalCopy
{
    public const string Version = "draft-2026-10-16";
    public const string OrganizingVersion = "organizing-interest-v1";
    public const string CounselNotice =
        "Draft for review by qualified Indian counsel. This text is not legal advice and is not a statement of which statutes or rules are in force.";

    public const string SignupCheckbox =
        "I am 18 or older. I agree to the Employee Voice India terms and privacy notice, draft version draft-2026-10-16. I understand this is an independent community, not a government service and not a trade union.";

    public const string OrganizingCheckbox =
        "I choose to record my interest in helping explore a future, independent employee organization for IT employees in India. This is not membership in a registered trade union, not a statutory membership register, and not a request that anyone represent me. I can withdraw this interest later without deleting my community account.";

    public const string OrganizingPurpose = "explore_future_employee_organization";

    public const string WorkEmailDisclaimer =
        "A work-email domain check shows that this member controlled an email address at an allowlisted domain when the check was completed. It does not, by itself, prove that they currently work at that organization.";

    public const string ManualReviewDisclaimer =
        "Manual review is a limited staff check of information the member submitted. It does not prove current employment, and the product does not collect identity documents.";

    public const string UnverifiedDisclaimer =
        "This member has not completed an employment check. Sign-in only shows control of the email address used for the account.";

    public const int MinPollCohort = 5;
    public const string DeletePhrase = "delete my account";
}
