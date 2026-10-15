import Link from "next/link";
import { Users, Pencil } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import StatusChip from "@/components/ui/StatusChip";
import EmptyState from "@/components/ui/EmptyState";
import IconActionButton from "@/components/ui/IconActionButton";
import DeleteUserButton from "./DeleteUserButton";
import { formatDateTime, getInitials } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import type { PublicUser } from "@/app/(dashboard)/peoples/users/queries";

const GRID_COLUMNS = "minmax(240px,1fr) 200px 180px 180px 110px";
const HEADERS = ["User", "Role", "Phone number", "Created on", "Action"];

export default function UserTable({ users, currentUserId }: { users: PublicUser[]; currentUserId: string }) {
  if (users.length === 0) {
    return <EmptyState icon={Users} message="No users found." />;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 1060 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLUMNS,
            columnGap: 16,
            alignItems: "center",
            padding: "0 20px",
            height: 44,
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
            whiteSpace: "nowrap",
          }}
        >
          {HEADERS.map((label, i) => (
            <span
              key={label}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: COLORS.slateMid,
                textAlign: i === HEADERS.length - 1 ? "right" : "left",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {users.map((user) => {
          const { time, date } = formatDateTime(user.createdAt);
          const name = `${user.firstName} ${user.lastName}`;
          return (
            <div
              key={user.id}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
                columnGap: 16,
                alignItems: "center",
                padding: "0 20px",
                height: 68,
                borderBottom: `1px solid ${COLORS.bgApp}`,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    flex: "0 0 auto",
                    borderRadius: 999,
                    background: COLORS.avatar,
                    color: "#fff",
                    fontFamily: FONTS.display,
                    fontWeight: 600,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    getInitials(user.firstName, user.lastName)
                  )}
                </span>
                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.35, minWidth: 0 }}>
                  <Link href={`/peoples/users/${user.id}/edit`} style={{ fontSize: 14, fontWeight: 600 }}>
                    {name}
                  </Link>
                  <span style={{ fontSize: 13, color: COLORS.slateMid }}>{user.email}</span>
                </span>
              </span>
              <span style={{ fontSize: 13.5, color: COLORS.text }}>{ROLE_LABELS[user.role]}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.text }}>{user.phoneNumber}</span>
              <StatusChip time={time} date={date} />
              <span style={{ justifySelf: "end", display: "flex", gap: 6 }}>
                <IconActionButton
                  icon={<Pencil size={15} strokeWidth={1.8} />}
                  title="Edit user"
                  href={`/peoples/users/${user.id}/edit`}
                />
                <DeleteUserButton
                  id={user.id}
                  name={name}
                  disabled={user.id === currentUserId}
                  disabledTitle="You can't delete your own account"
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
