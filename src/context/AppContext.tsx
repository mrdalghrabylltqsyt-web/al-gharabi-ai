import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  PlatformAccount,
  Post,
  PostStatus,
  CustomerConversation,
  ShowroomProduct,
  InstallmentPlan,
  ShowroomInfo,
  AppUser,
  SocialPlatformId,
} from '../types';
import {
  INITIAL_PLATFORMS,
  INITIAL_SHOWROOM_INFO,
  INITIAL_PRODUCTS,
  INITIAL_INSTALLMENT_PLANS,
  INITIAL_POSTS,
  INITIAL_CONVERSATIONS,
} from '../data/initialData';
import { apiService, getApiAuthToken, setApiAuthToken } from '../services/api';

interface AppContextType {
  // Navigation
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // Authentication & Session Gate
  currentUser: AppUser | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  loginWithGoogle: (credential: string) => Promise<void>;
  requestOwnerChallenge: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyOwnerChallenge: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;

  // Platforms
  platforms: PlatformAccount[];
  addCustomPlatform: (platform: Partial<PlatformAccount>) => void;
  togglePlatformStatus: (id: string) => void;
  syncAllPlatforms: () => void;

  // Posts & Approval Workflow
  posts: Post[];
  createPost: (post: Omit<Post, 'id' | 'createdAt' | 'history'>) => Post;
  updatePostStatus: (postId: string, newStatus: PostStatus, note?: string) => void;
  updatePostContent: (postId: string, updatedFields: Partial<Post>) => void;
  deletePost: (postId: string) => void;
  /** Re-reads the server workspace; used after server-side batch creation (e.g. campaigns). */
  refreshWorkspace: () => Promise<void>;

  // Customer Conversations
  conversations: CustomerConversation[];
  activeConversation: CustomerConversation | null;
  setActiveConversationId: (id: string | null) => void;
  sendCustomerReply: (conversationId: string, replyText: string, asAi?: boolean) => void;
  transferToHuman: (conversationId: string, staffName: string) => void;
  markConversationResolved: (conversationId: string) => void;
  addNewCustomerMessage: (channel: SocialPlatformId, customerName: string, text: string, phone?: string) => void;

  // Showroom Database
  showroomInfo: ShowroomInfo;
  updateShowroomInfo: (info: Partial<ShowroomInfo>) => void;
  products: ShowroomProduct[];
  addProduct: (product: Omit<ShowroomProduct, 'id'>) => void;
  updateProduct: (id: string, product: Partial<ShowroomProduct>) => void;
  deleteProduct: (id: string) => void;
  installmentPlans: InstallmentPlan[];
  addInstallmentPlan: (plan: Omit<InstallmentPlan, 'id'>) => void;
  deleteInstallmentPlan: (id: string) => void;

  // Users & Roles (Exclusively Managed by Owner via Server API)
  users: AppUser[];
  addUser: (user: { name: string; email: string; role: AppUser['role']; avatar?: string }) => Promise<void>;
  updateUserRole: (userId: string, role: AppUser['role']) => Promise<void>;
  updateUserStatus: (userId: string, active: boolean) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;

  // Notification / Stats
  notificationBadge: {
    pendingReviews: number;
    unreadMessages: number;
    scheduledToday: number;
  };
  toastMessage: string | null;
  showToast: (msg: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_PREFIX = 'algharabi_clean_v1_7_';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // Auth State
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(true);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [workspaceHydrated, setWorkspaceHydrated] = useState<boolean>(false);

  // Purge legacy mock data from browser localStorage if present
  useEffect(() => {
    try {
      const legacyKeys = [
        'algharabi_platforms',
        'algharabi_posts',
        'algharabi_conversations',
        'algharabi_products',
        'algharabi_plans',
        'algharabi_info',
        'algharabi_users',
        `${STORAGE_PREFIX}users`,
      ];
      legacyKeys.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore if localStorage unavailable
    }
  }, []);

  // Server workspace is the durable source of truth. Browser storage remains only a local cache.
  const hydrateWorkspace = async () => {
    try {
      const snapshot = await apiService.getWorkspaceSnapshot();
      if (snapshot?.showroom && typeof snapshot.showroom === 'object') setShowroomInfo((prev) => ({ ...prev, ...snapshot.showroom }));
      if (Array.isArray(snapshot?.products)) setProducts(snapshot.products as ShowroomProduct[]);
      if (Array.isArray(snapshot?.installmentPlans)) setInstallmentPlans(snapshot.installmentPlans as InstallmentPlan[]);
      if (Array.isArray(snapshot?.posts)) setPosts(snapshot.posts as Post[]);
      if (Array.isArray(snapshot?.conversations)) setConversations(snapshot.conversations as CustomerConversation[]);
      if (Array.isArray(snapshot?.platforms)) {
        setPlatforms((prev) => prev.map((local) => {
          const remote = snapshot.platforms.find((p: any) => p.id === local.id || p.platform === local.platform);
          if (!remote) return local;
          const connection = remote.connection || {};
          return { ...local, status: connection.status === 'connected' ? 'connected' : 'disconnected', handle: connection.accountName || local.handle, lastSyncTime: connection.connectedAt || 'غير مربوط بعد' };
        }));
      }
    } catch (err) {
      console.warn('Workspace snapshot hydration failed; keeping local cache:', err);
    } finally {
      setWorkspaceHydrated(true);
    }
  };

  // Initialize Auth & fetch verified user from backend
  useEffect(() => {
    const initAuth = async () => {
      try {
        // معاينة الجوال: الرابط يحمل توكن المعاينة، نقايضه بجلسة مالك حقيقية
        // ثم نمحو المعامل من الرابط فوراً حتى لا يبقى في التاريخ.
        // نستبدل أي جلسة قديمة: جلَسَات الخادم في الذاكرة، فجلسة سابقة تموت
        // عند إعادة التشغيل، ولو احترمناها لبقي رابط المعاينة معطلاً.
        try {
          const params = new URLSearchParams(window.location.search);
          const previewToken = params.get('preview_token');
          if (previewToken) {
            params.delete('preview_token');
            const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : '') + window.location.hash;
            window.history.replaceState({}, '', clean);
            try {
              const session = await apiService.previewLogin(previewToken);
              setApiAuthToken(session.token);
              setCurrentUser(session.user);
              setIsLoadingAuth(false);
              return;
            } catch { /* توكن غير صالح: نكمل في مسار الجلسة العادي */ }
          }
        } catch { /* بلا window */ }

        const token = getApiAuthToken();
        if (!token) {
          setIsLoadingAuth(false);
          return;
        }
        const res = await apiService.getAuthMe();
        if (res && res.success && res.user) {
          setCurrentUser(res.user);
          try {
            const serverUsers = await apiService.fetchUsers();
            setUsers(serverUsers);
          } catch (err) {
            console.warn('Could not fetch server users:', err);
          }
          await hydrateWorkspace();
        } else {
          setCurrentUser(null);
        }
      } catch {
        setCurrentUser(null);
      } finally {
        setIsLoadingAuth(false);
      }
    };
    initAuth();
  }, []);

  // Authentication Actions
  const loginWithGoogle = async (credential: string) => {
    setIsLoadingAuth(true);
    try {
      const res = await apiService.loginWithGoogle(credential);
      setCurrentUser(res.user);
      showToast(`مرحباً بك يا ${res.user.name} (${res.user.roleTitleArabic})`);
      try {
        const serverUsers = await apiService.fetchUsers();
        setUsers(serverUsers);
      } catch {}
      await hydrateWorkspace();
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const requestOwnerChallenge = async (email: string) => {
    return await apiService.requestOwnerChallenge(email);
  };

  const verifyOwnerChallenge = async (email: string, code: string) => {
    setIsLoadingAuth(true);
    try {
      const res = await apiService.verifyChallenge(email, code);
      setCurrentUser(res.user);
      showToast(`تم تأكيد الدخول كـ ${res.user.roleTitleArabic}`);
      try {
        const serverUsers = await apiService.fetchUsers();
        setUsers(serverUsers);
      } catch {}
      await hydrateWorkspace();
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const logout = async () => {
    await apiService.logout();
    setCurrentUser(null);
    setUsers([]);
    showToast('تم تسجيل الخروج بنجاح');
  };

  // Load from clean storage
  const [platforms, setPlatforms] = useState<PlatformAccount[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}platforms`);
      return saved ? JSON.parse(saved) : INITIAL_PLATFORMS;
    } catch {
      return INITIAL_PLATFORMS;
    }
  });

  const [posts, setPosts] = useState<Post[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}posts`);
      return saved ? JSON.parse(saved) : INITIAL_POSTS;
    } catch {
      return INITIAL_POSTS;
    }
  });

  const [conversations, setConversations] = useState<CustomerConversation[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}conversations`);
      return saved ? JSON.parse(saved) : INITIAL_CONVERSATIONS;
    } catch {
      return INITIAL_CONVERSATIONS;
    }
  });

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [showroomInfo, setShowroomInfo] = useState<ShowroomInfo>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}info`);
      return saved ? JSON.parse(saved) : INITIAL_SHOWROOM_INFO;
    } catch {
      return INITIAL_SHOWROOM_INFO;
    }
  });

  const [products, setProducts] = useState<ShowroomProduct[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}products`);
      return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
    } catch {
      return INITIAL_PRODUCTS;
    }
  });

  const [installmentPlans, setInstallmentPlans] = useState<InstallmentPlan[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}plans`);
      return saved ? JSON.parse(saved) : INITIAL_INSTALLMENT_PLANS;
    } catch {
      return INITIAL_INSTALLMENT_PLANS;
    }
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Sync content state to clean localStorage
  useEffect(() => {
    if (!workspaceHydrated) return;
    localStorage.setItem(`${STORAGE_PREFIX}platforms`, JSON.stringify(platforms));
  }, [platforms, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    localStorage.setItem(`${STORAGE_PREFIX}posts`, JSON.stringify(posts));
  }, [posts, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    localStorage.setItem(`${STORAGE_PREFIX}conversations`, JSON.stringify(conversations));
  }, [conversations, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    localStorage.setItem(`${STORAGE_PREFIX}products`, JSON.stringify(products));
  }, [products, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    localStorage.setItem(`${STORAGE_PREFIX}plans`, JSON.stringify(installmentPlans));
  }, [installmentPlans, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    localStorage.setItem(`${STORAGE_PREFIX}info`, JSON.stringify(showroomInfo));
  }, [showroomInfo, workspaceHydrated]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Add custom platform
  const addCustomPlatform = (newPlat: Partial<PlatformAccount>) => {
    const id = (newPlat.name || 'custom').toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    const fullPlatform: PlatformAccount = {
      id,
      platform: id,
      name: newPlat.name || 'منصة مخصصة',
      handle: newPlat.handle || '',
      status: 'disconnected',
      followers: 0,
      engagementRate: '0.0%',
      postsCount: 0,
      unreadMessages: 0,
      scheduledCount: 0,
      iconName: 'Share2',
      color: 'from-emerald-500 to-teal-700',
      badge: 'منصة إضافية',
      lastSyncTime: 'غير مربوط بعد',
      ...newPlat,
    };
    setPlatforms((prev) => [...prev, fullPlatform]);
    showToast(`تمت إضافة منصة "${fullPlatform.name}" لقائمة المنصات`);
  };

  const togglePlatformStatus = (id: string) => {
    const platform = platforms.find((p) => p.id === id);
    if (!platform) return;
    showToast(`منصة ${platform.name} مهيأة للربط. لا يتم اعتبارها متصلة قبل نجاح OAuth/API الفعلي.`);
  };

  const syncAllPlatforms = () => {
    const connected = platforms.filter((p) => p.status === 'connected').length;
    if (connected === 0) {
      showToast('لا توجد منصات متصلة فعلياً للمزامنة. لم يتم تنفيذ أي طلب خارجي.');
      return;
    }
    showToast(`تم فحص ${connected} منصة متصلة فعلياً دون تغيير حالة الحسابات.`);
  };

  // Post actions
  const createPost = (newPostData: Omit<Post, 'id' | 'createdAt' | 'history'>): Post => {
    const id = 'post-' + Date.now();
    const createdDate = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const newPost: Post = {
      ...newPostData,
      id,
      createdAt: createdDate,
      history: [
        {
          id: 'act-' + Date.now(),
          byUser: currentUser.name,
          userRole: currentUser.role,
          action: 'create',
          timestamp: createdDate,
          note: 'إنشاء المحتوى عبر الغرابي AI',
        },
      ],
    };

    setPosts((prev) => [newPost, ...prev]);
    void apiService.createWorkspaceContent(newPost as any).then((saved) => {
      if (saved) setPosts((prev) => prev.map((p) => (p.id === newPost.id ? { ...p, ...saved, authorName: p.authorName, authorRole: p.authorRole, history: p.history } : p)));
    }).catch((err) => { setPosts((prev) => prev.filter((p) => p.id !== newPost.id)); showToast(err.message || 'تعذر حفظ المحتوى على الخادم'); });
    showToast(`تم حفظ المحتوى بنجاح كـ [${newPost.status === 'draft' ? 'مسودة' : 'قيد المراجعة'}]`);
    return newPost;
  };

  const updatePostStatus = (postId: string, newStatus: PostStatus, note?: string) => {
    if (newStatus === 'published') {
      showToast('لا يمكن تسجيل المنشور كمُنشر قبل تنفيذ نشر خارجي موثّق من المنصة. تم الحفاظ على حالته الحالية.');
      return;
    }
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id === postId) {
          const actionMap: Partial<Record<PostStatus, any>> = {
            draft: 'create',
            review: 'submit_review',
            edited: 'edit',
            approved: 'approve',
            scheduled: 'schedule',
          };
          const newHistory = [
            ...p.history,
            {
              id: 'act-' + Date.now(),
              byUser: currentUser.name,
              userRole: currentUser.role,
              action: actionMap[newStatus] || 'edit',
              timestamp,
              note: note || `تغيير الحالة إلى ${newStatus}`,
            },
          ];

          const updated: Post = {
            ...p,
            status: newStatus,
            history: newHistory,
          };

          if (newStatus === 'scheduled' && !updated.scheduledFor) {
            updated.scheduledFor = timestamp;
          }

          return updated;
        }
        return p;
      })
    );

    const changedPost = posts.find((p) => p.id === postId);
    if (changedPost) {
      const updatedPost = { ...changedPost, status: newStatus, ...(newStatus === 'scheduled' && !changedPost.scheduledFor ? { scheduledFor: new Date().toISOString().replace('T',' ').slice(0,16) } : {}) };
      void apiService.updateWorkspaceContent(postId, updatedPost as any).catch((err) => showToast(err.message || 'تعذر حفظ حالة المحتوى'));
    }

    const statusNames: Record<PostStatus, string> = {
      draft: 'مسودة',
      review: 'قيد المراجعة',
      edited: 'تم التعديل',
      approved: 'تمت الموافقة',
      scheduled: 'مجدول للنشر',
      published: 'تم النشر بنجاح',
    };
    showToast(`تم تحديث حالة المنشور إلى: ${statusNames[newStatus]}`);
  };

  const updatePostContent = (postId: string, updatedFields: Partial<Post>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...updatedFields } : p)));
    void apiService.updateWorkspaceContent(postId, updatedFields as any).catch((err) => showToast(err.message || 'تعذر حفظ التعديلات على الخادم'));
    showToast('تم حفظ التعديلات على المنشور');
  };

  const deletePost = (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    void apiService.deleteWorkspaceContent(postId).catch((err) => showToast(err.message || 'تعذر حذف المنشور من الخادم'));
    showToast('تم حذف المنشور');
  };

  // Customer actions
  const sendCustomerReply = (conversationId: string, replyText: string, asAi: boolean = false) => {
    const timeStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === conversationId) {
          const newHistory = [
            ...c.history,
            {
              id: 'm-' + Date.now(),
              sender: asAi ? ('ai' as const) : ('human' as const),
              senderName: asAi ? 'الغرابي AI' : currentUser.name,
              text: replyText,
              timestamp: timeStr,
            },
          ];
          return {
            ...c,
            lastMessage: replyText,
            lastMessageTime: 'الآن',
            status: asAi ? 'ai_replied' : 'transferred_human',
            history: newHistory,
          };
        }
        return c;
      })
    );
    void apiService.updateWorkspaceConversation(conversationId, { replyText, asAi }).catch((err) => showToast(err.message || 'تعذر حفظ الرد على الخادم'));
    showToast('تم إرسال الرد بنجاح');
  };

  const transferToHuman = (conversationId: string, staffName: string) => {
    const timeStr = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === conversationId) {
          return {
            ...c,
            status: 'transferred_human',
            assignedStaff: staffName,
            history: [
              ...c.history,
              {
                id: 'm-' + Date.now(),
                sender: 'human' as const,
                senderName: 'إشعار النظام',
                text: `[تم تحويل المحادثة للمتابعة: ${staffName}]`,
                timestamp: timeStr,
              },
            ],
          };
        }
        return c;
      })
    );
    void apiService.updateWorkspaceConversation(conversationId, { status: 'transferred_human', assignedStaff: staffName }).catch((err) => showToast(err.message || 'تعذر حفظ التحويل على الخادم'));
    showToast(`تم تحويل المحادثة للمتابعة`);
  };

  const markConversationResolved = (conversationId: string) => {
    setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, status: 'resolved' } : c)));
    void apiService.updateWorkspaceConversation(conversationId, { status: 'resolved' }).catch((err) => showToast(err.message || 'تعذر حفظ إغلاق المحادثة'));
    showToast('تم إغلاق المحادثة بنجاح');
  };

  const addNewCustomerMessage = (
    channel: SocialPlatformId,
    customerName: string,
    text: string,
    phone?: string
  ) => {
    const newConv: CustomerConversation = {
      id: 'conv-' + Date.now(),
      customerName: customerName.trim() || 'عميل',
      phone: phone || '',
      channel,
      avatar: '',
      lastMessage: text,
      lastMessageTime: 'الآن',
      category: 'استفسار جديد',
      urgency: 'medium',
      status: 'new',
      history: [
        {
          id: 'm-new-' + Date.now(),
          sender: 'customer',
          text,
          timestamp: 'الآن',
        },
      ],
    };
    setConversations((prev) => [newConv, ...prev]);
    void apiService.createWorkspaceConversation(newConv as any).then((saved) => {
      if (saved) setConversations((prev) => prev.map((c) => (c.id === newConv.id ? saved as CustomerConversation : c)));
    }).catch((err) => { setConversations((prev) => prev.filter((c) => c.id !== newConv.id)); showToast(err.message || 'تعذر حفظ المحادثة على الخادم'); });
    setActiveConversationId(newConv.id);
    showToast(`رسالة جديدة واردة من ${newConv.customerName} عبر ${channel}`);
  };

  // Showroom Database Actions
  const updateShowroomInfo = (info: Partial<ShowroomInfo>) => {
    const next = { ...showroomInfo, ...info };
    setShowroomInfo(next);
    void apiService.updateWorkspaceShowroom(next as any).catch((err) => showToast(err.message || 'تعذر حفظ معلومات المعرض على الخادم'));
    showToast('تم تحديث معلومات المعرض');
  };

  const addProduct = (prod: Omit<ShowroomProduct, 'id'>) => {
    const newProd: ShowroomProduct = { ...prod, id: 'prod-' + Date.now() };
    setProducts((prev) => [newProd, ...prev]);
    void apiService.createWorkspaceProduct(newProd as any).then((saved) => {
      if (saved) setProducts((prev) => prev.map((p) => (p.id === newProd.id ? saved as ShowroomProduct : p)));
    }).catch((err) => { setProducts((prev) => prev.filter((p) => p.id !== newProd.id)); showToast(err.message || 'تعذر حفظ المنتج على الخادم'); });
    showToast(`تمت إضافة "${newProd.name}" إلى قاعدة بيانات المعرض`);
  };

  const updateProduct = (id: string, updated: Partial<ShowroomProduct>) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updated } : p)));
    void apiService.updateWorkspaceProduct(id, updated as any).catch((err) => showToast(err.message || 'تعذر حفظ تعديل المنتج'));
    showToast('تم تحديث بيانات المنتج');
  };

  const deleteProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    void apiService.deleteWorkspaceProduct(id).catch((err) => showToast(err.message || 'تعذر حذف المنتج من الخادم'));
    showToast('تم حذف المنتج من قاعدة البيانات');
  };

  const addInstallmentPlan = (plan: Omit<InstallmentPlan, 'id'>) => {
    const newPlan: InstallmentPlan = { ...plan, id: 'plan-' + Date.now() };
    setInstallmentPlans((prev) => [...prev, newPlan]);
    void apiService.createWorkspacePlan(newPlan as any).then((saved) => {
      if (saved) setInstallmentPlans((prev) => prev.map((p) => (p.id === newPlan.id ? saved as InstallmentPlan : p)));
    }).catch((err) => { setInstallmentPlans((prev) => prev.filter((p) => p.id !== newPlan.id)); showToast(err.message || 'تعذر حفظ خطة التقسيط على الخادم'); });
    showToast(`تمت إضافة نظام التقسيط "${newPlan.title}" بنجاح`);
  };

  const deleteInstallmentPlan = (id: string) => {
    setInstallmentPlans((prev) => prev.filter((p) => p.id !== id));
    void apiService.deleteWorkspacePlan(id).catch((err) => showToast(err.message || 'تعذر حذف خطة التقسيط من الخادم'));
    showToast('تم حذف نظام التقسيط');
  };

  // Roles & Users (Exclusively Managed by Owner via Server API)
  const addUser = async (newUser: { name: string; email: string; role: AppUser['role']; avatar?: string }) => {
    if (currentUser?.role !== 'owner') {
      showToast('خطأ: إضافة المستخدمين محصورة حصرياً بمالك النظام (Owner)');
      throw new Error('Only the owner can create users');
    }
    try {
      const user = await apiService.createUser(newUser);
      setUsers((prev) => [...prev, user]);
      showToast(`تمت إضافة المستخدم "${user.name}" بنجاح`);
    } catch (err: any) {
      showToast(err.message || 'فشلت إضافة المستخدم');
      throw err;
    }
  };

  const updateUserRole = async (userId: string, role: AppUser['role']) => {
    if (currentUser?.role !== 'owner') {
      showToast('خطأ: تعديل الأدوار محصور بمالك النظام (Owner)');
      throw new Error('Only the owner can update roles');
    }
    try {
      const updated = await apiService.updateUserRole(userId, role);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      showToast(`تم تحديث رتبة المستخدم إلى ${updated.roleTitleArabic}`);
    } catch (err: any) {
      showToast(err.message || 'فشل تحديث الرتبة');
      throw err;
    }
  };

  const updateUserStatus = async (userId: string, active: boolean) => {
    if (currentUser?.role !== 'owner') {
      showToast('خطأ: تعديل حالة المستخدم محصور بمالك النظام (Owner)');
      throw new Error('Only the owner can update user status');
    }
    try {
      const updated = await apiService.updateUserStatus(userId, active);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      showToast(active ? 'تم تفعيل حساب المستخدم' : 'تم تعطيل حساب المستخدم');
    } catch (err: any) {
      showToast(err.message || 'فشل تحديث حالة المستخدم');
      throw err;
    }
  };

  const deleteUser = async (userId: string) => {
    if (currentUser?.role !== 'owner') {
      showToast('خطأ: حذف المستخدم محصور بمالك النظام (Owner)');
      throw new Error('Only the owner can delete users');
    }
    try {
      await apiService.deleteUser(userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      showToast('تم حذف المستخدم بنجاح');
    } catch (err: any) {
      showToast(err.message || 'فشل حذف المستخدم');
      throw err;
    }
  };

  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  const notificationBadge = {
    pendingReviews: posts.filter((p) => p.status === 'review' || p.status === 'draft').length,
    unreadMessages: conversations.filter((c) => c.status === 'new').length,
    scheduledToday: posts.filter((p) => p.status === 'scheduled').length,
  };

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        currentUser,
        isAuthenticated: Boolean(currentUser),
        isLoadingAuth,
        loginWithGoogle,
        requestOwnerChallenge,
        verifyOwnerChallenge,
        logout,
        platforms,
        addCustomPlatform,
        togglePlatformStatus,
        syncAllPlatforms,
        posts,
        createPost,
        updatePostStatus,
        updatePostContent,
        deletePost,
        refreshWorkspace: hydrateWorkspace,
        conversations,
        activeConversation,
        setActiveConversationId,
        sendCustomerReply,
        transferToHuman,
        markConversationResolved,
        addNewCustomerMessage,
        showroomInfo,
        updateShowroomInfo,
        products,
        addProduct,
        updateProduct,
        deleteProduct,
        installmentPlans,
        addInstallmentPlan,
        deleteInstallmentPlan,
        users,
        addUser,
        updateUserRole,
        updateUserStatus,
        deleteUser,
        notificationBadge,
        toastMessage,
        showToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
