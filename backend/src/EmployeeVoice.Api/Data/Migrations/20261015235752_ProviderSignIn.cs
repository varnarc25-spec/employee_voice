using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EmployeeVoice.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ProviderSignIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "email",
                table: "users",
                type: "character varying(320)",
                maxLength: 320,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(320)",
                oldMaxLength: 320);

            migrationBuilder.AddColumn<string>(
                name: "google_subject",
                table: "users",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "linkedin_subject",
                table: "users",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "phone_e164",
                table: "users",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_google_subject",
                table: "users",
                column: "google_subject",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_linkedin_subject",
                table: "users",
                column: "linkedin_subject",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_users_phone_e164",
                table: "users",
                column: "phone_e164",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_users_google_subject",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_linkedin_subject",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_phone_e164",
                table: "users");

            migrationBuilder.DropColumn(
                name: "google_subject",
                table: "users");

            migrationBuilder.DropColumn(
                name: "linkedin_subject",
                table: "users");

            migrationBuilder.DropColumn(
                name: "phone_e164",
                table: "users");

            migrationBuilder.AlterColumn<string>(
                name: "email",
                table: "users",
                type: "character varying(320)",
                maxLength: 320,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(320)",
                oldMaxLength: 320,
                oldNullable: true);
        }
    }
}
