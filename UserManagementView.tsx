import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Users,
  ShieldCheck,
  Plus,
  CheckCircle2,
  XCircle,
  Shield,
  Trash2,
  Power,
  Lock,
  Mail,
  UserPlus,
  X,
} from 'lucide-react';
import { UserRole, AppUser } from '../../types';

export const UserManagementView: React.FC = () => {
  const { users, currentUser, addUser, updateUserRole, updateUserStatus, deleteUser, showToast } = useApp();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('staff');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isOwner = currentUser?.role === 'owner';

  const permissionsList = [
    { key: 'create_content', label: 'إنشاء وتوليد مسودات المحتوى بالذكاء الاصطناعي' },
    { key: 'review_content', label: 'مراجعة وتعديل منشورات الفريق' },
    { key: 'approve_publish', label: 'الموافقة والاعتماد النهائي وإطلاق النشر على المنصات' },
    { key: 'customer_chat', label: 'إدارة واستقبال محادثات العملاء وإرسال الردود' },
    { key: 'transfer_human', label: 'تحويل الحالات والعملاء إلى موظف بشري' },
    { key: 'edit_database', label: 'تعديل منتجات المعرض وأسعارها والأقساط' },
    { key: 'system_settings', label: 'إدارة المنصات الاجتماعية وربط الحسابات الجديدة' },
    { key: 'manage_users', label: 'إدارة مستخدمي النظام وتحديد الصلاحيات والأدوار' },
  ];

  const rolePermissions: Record<UserRole, Record<string, boolean>> = {
    owner: {
      create_content: true,
      review_content: true,
      approve_publish: true,
      customer_chat: true,
      transfer_human: true,
      edit_database: true,
      system_settings: true,
      manage_users: true,
    },
    manager: {
      create_content: true,
      review_content: true,
      approve_publish: true,
      customer_chat: true,
      transfer_human: true,
      edit_database: true,
      system_settings: true,
      manage_users: false,
    },
    content_creator: {
      create_content: true,
      review_content: true,
      approve_publish: false,
      customer_chat: false,
      transfer_human: false,
      edit_database: false,
      system_settings: false,
      manage_users: false,
    },
    staff: {
      create_content: false,
      review_content: false,
      approve_publish: false,
      customer_chat: true,
      transfer_human: true,
      edit_database: false,
      system_settings: false,
      manage_users: false,
    },
    customer_support: {
      create_content: false,
      review_content: false,
      approve_publish: false,
      customer_chat: true,
      transfer_human: true,
      edit_database: false,
      system_settings: false,
      manage_users: false,
    },
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) {
      showToast('يرجى ملء جميع الحقول المطلوبة');
      return;
    }
    setIsSubmitting(true);
    try {
      await addUser({
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        role: newRole,
      });
      setShowAddModal(false);
      setNewName('');
      setNewEmail('');
      setNewRole('staff');
    } catch (err: any) {
      // Error toast already displayed in context
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" />
              إدارة مستخدمي النظام ومصفوفة الصلاحيات
            </h2>
            <span className="text-xs bg-emerald-950 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-bold">
              حوكمة آمنة ومحمية بالخادم
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            صلاحيات إدارة وإضافة وتعديل المستخدمين محصورة حصرياً بمالك النظام (Owner).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs text-slate-300 bg-slate-950 px-4 py-2 rounded-xl border border-slate-800 flex items-center gap-2">
            <span>المستخدم الحالي:</span>
            <span className="text-emerald-400 font-bold">{currentUser?.name}</span>
            {isOwner && (
              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30 font-bold flex items-center gap-1">
                <Shield className="w-3 h-3" />
                مالك النظام
              </span>
            )}
          </div>

          {isOwner && (
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>إضافة مستخدم جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Non-Owner Security Notice */}
      {!isOwner && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-3">
          <Lock className="w-5 h-5 text-amber-400 shrink-0" />
          <span>
            تنبيه أمان: أنت مسجل برتبة ({currentUser?.roleTitleArabic}). ميزات إضافة أو تعديل أو حذف المستخدمين مفعلة فقط لحساب مالك النظام (Owner).
          </span>
        </div>
      )}

      {/* Users List Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.map((u) => {
          const isCurrentUserCard = currentUser?.id === u.id;
          const isTargetOwner = u.role === 'owner';

          return (
            <div
              key={u.id}
              className={`p-5 rounded-2xl border transition relative space-y-4 ${
                isTargetOwner
                  ? 'bg-amber-950/20 border-amber-500/40 shadow-lg'
                  : isCurrentUserCard
                  ? 'bg-emerald-950/30 border-emerald-500/50'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {u.avatar ? (
                    <img
                      src={u.avatar}
                      alt={u.name}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-700"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400 font-black text-sm">
                      {isTargetOwner ? (
                        <Shield className="w-6 h-6 text-amber-400" />
                      ) : (
                        <ShieldCheck className="w-6 h-6 text-emerald-400" />
                      )}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-bold text-sm text-white">{u.name}</h3>
                      {isCurrentUserCard && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-500/30">
                          أنت
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-xs font-semibold block ${
                        isTargetOwner ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {u.roleTitleArabic}
                    </span>
                  </div>
                </div>

                {isTargetOwner ? (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/40 font-black flex items-center gap-1">
                    <Shield className="w-2.5 h-2.5" />
                    المالك الوحيد
                  </span>
                ) : (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                      u.active !== false
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    }`}
                  >
                    {u.active !== false ? 'نشط' : 'معطل'}
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
                <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span dir="ltr" className="truncate text-slate-300">{u.email}</span>
              </p>

              {/* Owner Controls (Only visible/actionable by Owner for non-owner users) */}
              {isOwner && !isTargetOwner && (
                <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">تغيير الرتبة:</span>
                    <select
                      value={u.role}
                      onChange={(e) => updateUserRole(u.id, e.target.value as UserRole)}
                      className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-emerald-400 font-semibold focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      <option value="manager">المدير العام (Manager)</option>
                      <option value="content_creator">مسؤول المحتوى (Content)</option>
                      <option value="staff">مبيعات التقسيط (Staff)</option>
                      <option value="customer_support">خدمة العملاء (Support)</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => updateUserStatus(u.id, u.active === false)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer border ${
                        u.active !== false
                          ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                          : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      <span>{u.active !== false ? 'تعطيل الحساب' : 'تفعيل الحساب'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`هل أنت متأكد من رغبتك في حذف المستخدم "${u.name}" نهائياً من النظام؟`)) {
                          deleteUser(u.id);
                        }
                      }}
                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition cursor-pointer"
                      title="حذف المستخدم"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add User Modal (Exclusively for Owner) */}
      {showAddModal && isOwner && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white text-base">إضافة مستخدم معتمد جديد</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">الاسم الكامل</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: خالد المطيري"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 text-xs focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">البريد الإلكتروني</label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="name@algharabi.com"
                  dir="ltr"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 text-xs focus:outline-none focus:border-emerald-500 transition"
                />
                <p className="text-[10px] text-slate-400">
                  سيتمكن هذا الموظف من تسجيل الدخول والمصادقة بهذا البريد حصراً.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 block">الرتبة والصلاحيات</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs focus:outline-none focus:border-emerald-500 transition cursor-pointer"
                >
                  <option value="manager">المدير العام (Manager)</option>
                  <option value="content_creator">مسؤول المحتوى (Content Creator)</option>
                  <option value="staff">مبيعات التقسيط (Staff)</option>
                  <option value="customer_support">خدمة العملاء (Support)</option>
                </select>
                <p className="text-[10px] text-amber-400">
                  ملاحظة أمان: لا يمكن لأحد تعيين رتبة Owner، فهي محصورة بمالك النظام فقط.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'جاري الحفظ في الخادم...' : 'حفظ وإضافة المستخدم'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permissions Matrix */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          مصفوفة الصلاحيات الرسمية لمعرض الغرابي للتقسيط
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="pb-3 font-semibold">الصلاحية</th>
                <th className="pb-3 font-semibold text-center text-amber-400">مالك النظام (Owner)</th>
                <th className="pb-3 font-semibold text-center">المدير العام</th>
                <th className="pb-3 font-semibold text-center">مسؤول المحتوى</th>
                <th className="pb-3 font-semibold text-center">مبيعات التقسيط</th>
                <th className="pb-3 font-semibold text-center">خدمة العملاء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {permissionsList.map((perm) => (
                <tr key={perm.key} className="hover:bg-slate-950/40 transition">
                  <td className="py-3.5 text-slate-200 font-medium">{perm.label}</td>
                  <td className="py-3.5 text-center bg-amber-500/5">
                    {rolePermissions.owner[perm.key] ? (
                      <CheckCircle2 className="w-4 h-4 text-amber-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
                  </td>
                  <td className="py-3.5 text-center">
                    {rolePermissions.manager[perm.key] ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
                  </td>
                  <td className="py-3.5 text-center">
                    {rolePermissions.content_creator[perm.key] ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
                  </td>
                  <td className="py-3.5 text-center">
                    {rolePermissions.staff[perm.key] ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
                  </td>
                  <td className="py-3.5 text-center">
                    {rolePermissions.customer_support[perm.key] ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
