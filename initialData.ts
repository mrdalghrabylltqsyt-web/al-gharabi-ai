import {
  PlatformAccount,
  ShowroomInfo,
  ShowroomProduct,
  InstallmentPlan,
  Post,
  CustomerConversation,
  AppUser,
} from '../types';

/**
 * 10 Supported Social Platforms (Ready for connection, no dummy accounts or keys)
 */
export const INITIAL_PLATFORMS: PlatformAccount[] = [
  {
    id: 'tiktok',
    platform: 'tiktok',
    name: 'TikTok',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Video',
    color: 'from-pink-500 to-rose-600',
    badge: 'فيديوهات قصيرة',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'youtube',
    platform: 'youtube',
    name: 'YouTube',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Youtube',
    color: 'from-red-600 to-red-700',
    badge: 'فيديوهات طويلة وشورتس',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'facebook',
    platform: 'facebook',
    name: 'Facebook',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Facebook',
    color: 'from-blue-600 to-blue-700',
    badge: 'صفحة المعرض الرسمية',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'instagram',
    platform: 'instagram',
    name: 'Instagram',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Instagram',
    color: 'from-purple-600 via-pink-600 to-amber-500',
    badge: 'ريلز ومنشورات بصرية',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'whatsapp',
    platform: 'whatsapp',
    name: 'WhatsApp Business',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'MessageCircle',
    color: 'from-emerald-500 to-green-600',
    badge: 'قناة المحادثات المباشرة',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'telegram',
    platform: 'telegram',
    name: 'Telegram',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Send',
    color: 'from-sky-400 to-blue-500',
    badge: 'قناة العروض الفورية',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'x',
    platform: 'x',
    name: 'X (Twitter)',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Twitter',
    color: 'from-slate-700 to-slate-950',
    badge: 'الأخبار والعروض التفاعلية',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'snapchat',
    platform: 'snapchat',
    name: 'Snapchat',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Ghost',
    color: 'from-yellow-400 to-amber-500',
    badge: 'ستوري وعدسات',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'threads',
    platform: 'threads',
    name: 'Threads',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'Hash',
    color: 'from-slate-800 to-black',
    badge: 'محادثات ونقاشات',
    lastSyncTime: 'غير مربوط بعد',
  },
  {
    id: 'google_business',
    platform: 'google_business',
    name: 'Google Business Profile',
    handle: '',
    status: 'disconnected',
    followers: 0,
    engagementRate: '0.0%',
    postsCount: 0,
    unreadMessages: 0,
    scheduledCount: 0,
    iconName: 'MapPin',
    color: 'from-blue-500 to-emerald-600',
    badge: 'الملف التجاري والبحث المحلي',
    lastSyncTime: 'غير مربوط بعد',
  },
];

/**
 * Showroom Core Information (Clean, no dummy phone numbers or addresses)
 */
export const INITIAL_SHOWROOM_INFO: ShowroomInfo = {
  name: 'معرض الغرابي للتقسيط',
  tagline: 'أنظمة وحلول التقسيط الميسر',
  address: '',
  city: '',
  phoneUnified: '',
  whatsappSales: '',
  supportEmail: '',
  workingHours: '',
  about: 'معرض الغرابي للتقسيط - خدمات وحلول تمويل وتقسيط ميسرة ومعتمدة.',
  policies: [],
  faqs: [],
};

/**
 * Clean Showroom Products (Zero mock items)
 */
export const INITIAL_PRODUCTS: ShowroomProduct[] = [];

/**
 * Clean Installment Plans (Zero mock plans)
 */
export const INITIAL_INSTALLMENT_PLANS: InstallmentPlan[] = [];

/**
 * Clean Posts (Zero mock posts)
 */
export const INITIAL_POSTS: Post[] = [];

/**
 * Clean Conversations (Zero mock customer chats)
 */
export const INITIAL_CONVERSATIONS: CustomerConversation[] = [];

/**
 * Users: ONLY System Owner initially.
 * No virtual users or virtual managers created automatically.
 */
export const APP_USERS: AppUser[] = [
  {
    id: 'owner',
    name: 'مالك النظام (Owner)',
    role: 'owner',
    roleTitleArabic: 'مالك النظام (Owner)',
    email: '',
    avatar: '',
    active: true,
  },
];
