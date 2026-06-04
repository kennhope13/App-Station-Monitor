using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    public partial class AddRuleSetField : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RuleSet",
                table: "Rules",
                type: "text",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RuleSet",
                table: "Rules");
        }
    }
}
