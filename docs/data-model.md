# Data model

Primary keys are UUIDs. Timestamps are UTC. Table and column names are snake_case. Foreign keys use `ON DELETE RESTRICT`. Enums are stored as strings.

```mermaid
erDiagram
  User ||--|| EmployeeProfile : has
  User ||--o{ EmploymentVerification : submits
  User ||--o{ RefreshSession : opens
  User ||--o{ ConsentRecord : grants
  User ||--o{ OrganizationInterest : may_record
  ConsentRecord ||--o| OrganizationInterest : supports
  Organization ||--o{ EmploymentVerification : domain
  User ||--o{ Post : writes
  Post ||--o{ Comment : has
  User ||--o{ Reaction : gives
  User ||--o{ Report : files
  User ||--o{ UserBlock : creates
  User ||--o{ Notification : receives
  User ||--o| NotificationPreference : sets
  User ||--o{ AdminRole : holds
  User ||--o{ AuditLog : actor
  Poll ||--|{ PollOption : offers
  Poll ||--o{ PollEligibility : records_voter
  Poll ||--o{ PollBallot : records_choice
  PollOption ||--o{ PollBallot : selected
```

`PollEligibility` stores the member and the poll. `PollBallot` stores the poll, the option, and the calendar date. There is no foreign key between those two tables. A check constraint requires `min_cohort >= 5`. Results are returned only after the poll is closed and at least five ballots exist.

`OrganizationInterest` is queried only by the member who recorded it and by administrators. It is not joined into the public feed.

Employment verification stores a method, a status, an optional email domain, and a reviewer note. Work-email addresses and employer names are scheduled for clearing. The API does not accept identity documents.

Public profile responses omit email, legal name, employer, and verification evidence. The account owner can still see their own email on `GET /api/v1/me`.
