using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class RenameRoiPointColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Ty",
                table: "RoiPoints",
                newName: "Y");

            migrationBuilder.RenameColumn(
                name: "Tx",
                table: "RoiPoints",
                newName: "X");

            migrationBuilder.RenameColumn(
                name: "PreAlarmThreshold",
                table: "RoiPoints",
                newName: "WarningThreshold");

            migrationBuilder.RenameColumn(
                name: "Name",
                table: "RoiPoints",
                newName: "Label");

            migrationBuilder.AddColumn<string>(
                name: "Color",
                table: "RoiPoints",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PointId",
                table: "RoiPoints",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "RoiPoints",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Color",
                table: "RoiPoints");

            migrationBuilder.DropColumn(
                name: "PointId",
                table: "RoiPoints");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "RoiPoints");

            migrationBuilder.RenameColumn(
                name: "Y",
                table: "RoiPoints",
                newName: "Ty");

            migrationBuilder.RenameColumn(
                name: "X",
                table: "RoiPoints",
                newName: "Tx");

            migrationBuilder.RenameColumn(
                name: "WarningThreshold",
                table: "RoiPoints",
                newName: "PreAlarmThreshold");

            migrationBuilder.RenameColumn(
                name: "Label",
                table: "RoiPoints",
                newName: "Name");
        }
    }
}
