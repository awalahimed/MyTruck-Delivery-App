// Format currency in ETB
export function money(amount) {
  const n = Number(amount) || 0;
  return `ETB ${n.toFixed(2)}`;
}

// Format a Firestore Timestamp or JS Date
export function formatDate(timestamp) {
  if (!timestamp) return "";
  let date;
  if (timestamp?.toDate) {
    date = timestamp.toDate();
  } else if (timestamp?.seconds) {
    date = new Date(timestamp.seconds * 1000);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    return "";
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
