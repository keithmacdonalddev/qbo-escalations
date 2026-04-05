import { useEffect, useState } from 'react';
import { getDefaultGmailAccount } from '../lib/accountDefaults.js';
import { apiFetchJson } from '../api/http.js';

export default function useUnreadEmailCount() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;

    const fetchUnread = () => {
      const defaultEmail = getDefaultGmailAccount();
      apiFetchJson('/api/gmail/unified/unread-counts', {}, 'Failed to load unread counts')
        .then((data) => {
          if (!active || !data?.ok) return;
          const counts = data.counts || {};
          const count = defaultEmail && counts[defaultEmail] != null
            ? counts[defaultEmail]
            : (counts.total ?? 0);
          setUnreadCount(count);
        })
        .catch(() => {});
    };

    fetchUnread();
    const id = setInterval(fetchUnread, 60_000);

    const onStorage = (e) => {
      if (e.key === 'qbo-default-gmail-account') fetchUnread();
    };
    const onDefaultChange = () => fetchUnread();

    window.addEventListener('storage', onStorage);
    window.addEventListener('default-email-changed', onDefaultChange);

    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('default-email-changed', onDefaultChange);
    };
  }, []);

  return unreadCount;
}
