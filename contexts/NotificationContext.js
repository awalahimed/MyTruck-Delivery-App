import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import * as Notifications from "expo-notifications";
import { db } from "../firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  addDoc,
} from "firebase/firestore";
import { UserAuth } from "./AuthContext";
import {
  registerForPushNotificationsAsync,
  unregisterPushTokenAsync,
  presentLocalNotification,
} from "../services/notificationService";
import { navigate } from "../navigation/RootNavigation";

const NotificationContext = createContext({
  notifications: [],
  unreadCount: 0,
  loading: true,
  preferences: {},
  markAsRead: async () => {},
  markAllAsRead: async () => {},
  deleteNotification: async () => {},
  updatePreferences: async () => {},
  triggerTestNotification: async () => {},
  handleNotificationDeepLink: () => {},
});

export function NotificationProvider({ children }) {
  const { user, dbUser } = UserAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState({
    orderUpdates: true,
    deliveryTracking: true,
    promotions: true,
    sound: true,
    vibration: true,
  });

  const pushTokenRef = useRef(null);
  const hasInitialLoadedRef = useRef(false);

  // Sync user preferences from dbUser
  useEffect(() => {
    if (dbUser?.notificationPreferences) {
      setPreferences((prev) => ({
        ...prev,
        ...dbUser.notificationPreferences,
      }));
    }
  }, [dbUser]);

  // Deep link router based on notification payload data
  const handleNotificationDeepLink = useCallback((data) => {
    if (!data) {
      navigate("NotificationCenter");
      return;
    }

    const targetRoute = data.targetRoute;
    const orderId = data.orderId || data.params?.orderId;

    if (targetRoute === "TrackOrder" || (!targetRoute && orderId)) {
      navigate("TrackOrder", { orderId });
    } else if (targetRoute === "SellerHome") {
      navigate("SellerHome");
    } else if (targetRoute === "DriverDashboard") {
      navigate("DriverDashboard");
    } else if (targetRoute === "AdminDashboard") {
      navigate("AdminDashboard", { tab: data.params?.tab || "dashboard" });
    } else if (targetRoute === "Restaurant") {
      navigate("Restaurant", { id: data.businessId });
    } else if (targetRoute === "ProductDelivery") {
      navigate("ProductDelivery", { id: data.businessId });
    } else {
      navigate("NotificationCenter");
    }
  }, []);

  // Register push notifications and setup real-time Firestore sync
  useEffect(() => {
    if (!user?.uid) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    let isMounted = true;

    // 1. Register push token with backend and Firestore
    registerForPushNotificationsAsync(user.uid).then((token) => {
      if (isMounted && token) {
        pushTokenRef.current = token;
      }
    });

    // 2. Real-time Firestore notifications subscription
    const notifQuery = query(
      collection(db, "notifications"),
      where("recipientUid", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      notifQuery,
      (snapshot) => {
        if (!isMounted) return;
        const list = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() });
        });

        // Robust client-side sort by createdAt descending (handles serverTimestamp lag)
        list.sort((a, b) => {
          const timeA =
            a.createdAt?.toMillis?.() ||
            (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0) ||
            0;
          const timeB =
            b.createdAt?.toMillis?.() ||
            (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0) ||
            0;
          return timeB - timeA;
        });

        const unread = list.filter((n) => n.isRead !== true).length;
        setNotifications(list);
        setUnreadCount(unread);
        setLoading(false);

        // Instant local heads-up push banner for any newly received notifications
        if (hasInitialLoadedRef.current) {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
              const data = change.doc.data();
              if (data?.title) {
                presentLocalNotification({
                  title: data.title,
                  body: data.body || data.message || "New notification received",
                  data: data.data || { targetRoute: "NotificationCenter" },
                  category: data.category || "orders",
                }).catch(() => {});
              }
            }
          });
        } else {
          hasInitialLoadedRef.current = true;
        }
      },
      (error) => {
        console.warn("Notifications subscription error:", error?.message);
        setLoading(false);
      }
    );

    // 3. Listen for push notification responses (user tapped on OS push banner)
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const payloadData = response?.notification?.request?.content?.data || {};
        handleNotificationDeepLink(payloadData);
      });

    // 4. Foreground notification listener
    const notificationListener =
      Notifications.addNotificationReceivedListener((notification) => {
        // Can be used to play custom chime or vibrate if enabled in preferences
      });

    return () => {
      isMounted = false;
      unsubscribe();
      responseSubscription.remove();
      notificationListener.remove();
    };
  }, [user?.uid, handleNotificationDeepLink]);

  // Mark single notification as read
  const markAsRead = useCallback(async (notificationId) => {
    if (!notificationId) return;
    try {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));

      await updateDoc(doc(db, "notifications", notificationId), {
        isRead: true,
        readAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn("Error marking notification read:", err?.message);
    }
  }, []);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    try {
      const unreadList = notifications.filter((n) => n.isRead !== true);
      if (unreadList.length === 0) return;

      // Optimistic update
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);

      const batch = writeBatch(db);
      unreadList.forEach((n) => {
        batch.update(doc(db, "notifications", n.id), {
          isRead: true,
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
    } catch (err) {
      console.warn("Error marking all read:", err?.message);
    }
  }, [notifications]);

  // Delete notification
  const deleteNotification = useCallback(async (notificationId) => {
    if (!notificationId) return;
    try {
      // Optimistic update
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      await deleteDoc(doc(db, "notifications", notificationId));
    } catch (err) {
      console.warn("Error deleting notification:", err?.message);
    }
  }, []);

  // Update notification preferences
  const updatePreferences = useCallback(
    async (newPreferences) => {
      if (!user?.uid) return;
      try {
        const merged = { ...preferences, ...newPreferences };
        setPreferences(merged);
        await updateDoc(doc(db, "user", user.uid), {
          notificationPreferences: merged,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn("Error updating preferences:", err?.message);
      }
    },
    [user?.uid, preferences]
  );

  // Trigger test notification (persists to Firestore + local OS banner)
  const triggerTestNotification = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const testItem = {
        recipientUid: user.uid,
        type: "TEST_NOTIFICATION",
        category: "SYSTEM",
        title: "MyTruck Notification Engine Active! 🔔",
        body: "Real-time alerts, sound, and deep-linking are configured and operational.",
        data: { targetRoute: "NotificationCenter" },
        priority: "HIGH",
        isRead: false,
        readAt: null,
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, "notifications"), testItem);

      await presentLocalNotification({
        title: testItem.title,
        body: testItem.body,
        data: testItem.data,
      });
    } catch (err) {
      console.warn("Error triggering test notification:", err?.message);
    }
  }, [user?.uid]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        preferences,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        updatePreferences,
        triggerTestNotification,
        handleNotificationDeepLink,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
