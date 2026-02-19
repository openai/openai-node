import React from 'react';
import {
  Search,
  Plus,
  Grid3x3,
  Bell,
  User,
  MessageSquare,
  HelpCircle,
  Phone,
  Facebook,
  Mail,
  Package } from
'lucide-react';
interface DashboardPageProps {
  onNavigateToComplaint?: () => void;
  onNavigateToQuestion?: () => void;
}
export function DashboardPage({
  onNavigateToComplaint,
  onNavigateToQuestion
}: DashboardPageProps) {
  return (
    <div className="flex h-screen w-full bg-[#F9FAFB] font-sans overflow-hidden">
      {/* Left Sidebar */}
      <aside className="w-[320px] bg-white border-r border-gray-200 flex flex-col flex-shrink-0 z-20">
        {/* Logo Area */}
        <div className="p-4 flex items-center gap-3 border-b border-gray-100">
          <img
            src="/logo-new.png"
            alt="GDI Logo"
            className="w-10 h-10 object-contain" />

          <span className="font-bold text-[#1B2A4A] font-khmer-title text-sm leading-tight">
            អគ្គនាយកដ្ឋានអន្តោប្រវេសន៍
          </span>
        </div>

        {/* Search & Action */}
        <div className="p-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索"
              className="w-full pl-9 pr-4 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100" />

          </div>
          <button className="w-9 h-9 flex items-center justify-center bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-gray-600">
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4">
          <button className="pb-3 border-b-2 border-[#1B2A4A] text-[#1B2A4A] font-medium text-sm px-2">
            评论
          </button>
          <button className="pb-3 border-b-2 border-transparent text-gray-500 hover:text-gray-700 font-medium text-sm px-2 ml-4">
            问题与解答
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="w-4 h-4 rounded-full border-[5px] border-[#1B2A4A]"></div>
              <span className="text-sm text-gray-700">全部</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="w-4 h-4 rounded-full border border-gray-300"></div>
              <span className="text-sm text-gray-700">草稿</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="w-4 h-4 rounded-full border border-gray-300"></div>
              <span className="text-sm text-gray-700">提交</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="w-4 h-4 rounded-full border border-gray-300"></div>
              <span className="text-sm text-gray-700">待办的</span>
            </label>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="w-4 h-4 rounded-full border border-gray-300"></div>
              <span className="text-sm text-gray-700">关闭</span>
            </label>
          </div>
        </div>

        {/* Empty State */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <Package className="w-12 h-12 text-gray-300" />
          </div>
          <p className="text-gray-400 text-sm">不存在评论</p>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center">
            <span className="text-[#3B82F6] font-bold text-sm tracking-wide">
              HOTLINE
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-gray-700 text-sm font-medium cursor-pointer">
              <span>中文</span>
              <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center">
                <img
                  src="https://firebasestorage.googleapis.com/v0/b/egdi-ecosystem.appspot.com/o/eligibleNationalities%2Fchina.png?alt=media&token=094e6a2b-6af6-430d-9f51-5c74b70882e8"
                  alt="Chinese"
                  className="w-8 h-8 rounded-full object-cover" />

              </div>
            </div>
            <button className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center hover:bg-gray-300 transition-colors">
              <Grid3x3 className="w-5 h-5 text-gray-700" />
            </button>
            <button className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center hover:bg-gray-300 transition-colors relative">
              <Bell className="w-5 h-5 text-gray-700" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-gray-200"></span>
            </button>
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden cursor-pointer">
              <User className="w-6 h-6 text-gray-400" />
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="flex-1 p-8 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl">
            {/* Card 1: Post Comment */}
            <div
              onClick={onNavigateToComplaint}
              className="bg-white rounded-xl p-8 shadow-sm border-2 border-transparent flex flex-col items-center text-center hover:border-[#F57C20] hover:shadow-md transition-all cursor-pointer h-full group">

              <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mb-6">
                <MessageSquare className="w-8 h-8 text-pink-500" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-[#F57C20] transition-colors">
                发表评论
              </h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                对于有关移民程序、系统或官员的任何问题，请提交正式投诉。
              </p>
            </div>

            {/* Card 2: Have a Question */}
            <div
              onClick={onNavigateToQuestion}
              className="bg-white rounded-xl p-8 shadow-sm border-2 border-transparent flex flex-col items-center text-center hover:border-[#F57C20] hover:shadow-md transition-all cursor-pointer h-full group">

              <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mb-6">
                <HelpCircle className="w-8 h-8 text-teal-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-[#F57C20] transition-colors">
                有一个问题?
              </h3>
              <p className="text-gray-500 text-sm leading-relaxed">
                如果您需要有关任何移民问题的澄清或帮助，请向我们提交问题。
              </p>
            </div>

            {/* Card 3: Contact */}
            <div className="bg-[#F57C20] rounded-xl p-8 shadow-sm text-white flex flex-col h-full">
              <h3 className="text-xl font-bold mb-6 text-center">接触</h3>
              <div className="space-y-4 flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-medium">(+855) 68 386 699</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-medium">(+855) 78 386 699</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-medium">(+855) 87 386 699</span>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                    <Facebook className="w-4 h-4 text-white" />
                  </div>
                  <a
                    href="#"
                    className="font-medium underline hover:text-white/90">

                    GDIOfficial
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-4 h-4 text-white" />
                  </div>
                  <a
                    href="mailto:hotline@immigration.gov.kh"
                    className="font-medium underline hover:text-white/90 text-sm">

                    hotline@immigration.gov.kh
                  </a>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>);

}