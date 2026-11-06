// Order status metadata
const STATUS_MAP = {
  PENDING:        { label: "Pending",        tone: "warning" },
  ACCEPTED:       { label: "Accepted",       tone: "success" },
  PREPARING:      { label: "Preparing",      tone: "info" },
  READY:          { label: "Ready",          tone: "info" },
  DRIVERACCEPTED: { label: "Driver assigned",tone: "info" },
  DRIVERPICKEDUP: { label: "On the way",     tone: "primary" },
  COMPLETE:       { label: "Delivered",      tone: "success" },
  DECLINED:       { label: "Declined",       tone: "error" },
  CANCELLED:      { label: "Cancelled",      tone: "error" },
};

export function statusInfo(status) {
  return STATUS_MAP[status] || { label: status || "Unknown", tone: "muted" };
}
