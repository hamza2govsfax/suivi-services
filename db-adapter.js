/**
 * db-adapter.js
 * ------------------------------------------------------------------------
 * يحوّل نداءات window.claude.use("db") (واجهة شبيهة بـ Firestore:
 * DB.doc(path).set()/.onSnapshot(), DB.collection(name).doc(id).set()/
 * .delete(), DB.collection(name).add()) إلى نداءات REST حقيقية نحو خادم
 * Express (انظر مجلد backend/).
 *
 * الاستعمال (في index.html، قبل استدعاء boot()):
 *   window.API_BASE_URL = "http://localhost:4000/api";
 *   DB = createApiDb(window.API_BASE_URL, () => localStorage.getItem("sfax_token"));
 *
 * ملاحظة على onSnapshot: لا يوجد اتصال حي (WebSocket) في هذا الإصدار؛
 * يُنفَّذ "استماع" مبسّط عبر استقصاء دوري (polling) بفاصل زمني معقول،
 * وهو كافٍ لتطبيق إداري داخلي بهذا الحجم. يمكن لاحقًا استبداله بـ
 * WebSocket/SSE دون تغيير أي شيء في بقية التطبيق.
 */
function createApiDb(baseUrl, getToken, onAuthError) {
  const CONFIG_POLL_MS = 45000;
  const COLLECTION_POLL_MS = 15000;

  async function request(path, options) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      (options && options.headers) || {}
    );
    const token = getToken && getToken();
    if (token) headers["Authorization"] = "Bearer " + token;

    const res = await fetch(baseUrl + path, Object.assign({}, options, { headers }));

    if (res.status === 401 || res.status === 403) {
      if (onAuthError) onAuthError();
      throw new Error("غير مصرح بالدخول (" + res.status + ")");
    }
    if (!res.ok) {
      let msg = "خطأ في الخادم (" + res.status + ")";
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch (e) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function docRef(path) {
    // path على شكل "config/main"
    return {
      async set(data) {
        return request("/" + path, { method: "PUT", body: JSON.stringify(data) });
      },
      onSnapshot(cb, errCb) {
        let stopped = false;
        const poll = async () => {
          try {
            const data = await request("/" + path, { method: "GET" });
            cb({ exists: data !== null, data: data });
          } catch (e) {
            if (errCb) errCb(e);
          }
          if (!stopped) setTimeout(poll, CONFIG_POLL_MS);
        };
        poll();
        return () => {
          stopped = true;
        };
      },
    };
  }

  function collectionRef(name) {
    return {
      doc(id) {
        return {
          async set(data) {
            return request(`/${name}/${encodeURIComponent(id)}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
          },
          async delete() {
            return request(`/${name}/${encodeURIComponent(id)}`, { method: "DELETE" });
          },
        };
      },
      async add(data) {
        return request(`/${name}`, { method: "POST", body: JSON.stringify(data) });
      },
      onSnapshot(cb, errCb) {
        let stopped = false;
        const poll = async () => {
          try {
            const rows = await request(`/${name}`, { method: "GET" });
            cb({ docs: (rows || []).map((r) => ({ id: r.id, data: r })) });
          } catch (e) {
            if (errCb) errCb(e);
          }
          if (!stopped) setTimeout(poll, COLLECTION_POLL_MS);
        };
        poll();
        return () => {
          stopped = true;
        };
      },
    };
  }

  return {
    doc: docRef,
    collection: collectionRef,
  };
}
