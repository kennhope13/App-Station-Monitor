using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class RevertToTxTy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
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
        }
    }
}
