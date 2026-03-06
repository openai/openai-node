import React from 'react';
import {
  X,
  Grid3x3,
  Bell,
  User,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Type,
  AlignLeft,
  Paperclip,
  ChevronDown } from
'lucide-react';
interface ComplaintFormPageProps {
  onBack: () => void;
}
export function ComplaintFormPage({ onBack }: ComplaintFormPageProps) {
  return (
    <div className="min-h-screen bg-[#F3F4F6] font-sans flex flex-col">
      {/* Top Header (Same as Dashboard) */}
      <header className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0 sticky top-0 z-50">
        <div className="flex items-center">
          <span className="text-[#3B82F6] font-bold text-sm tracking-wide">
            HOTLINE
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-gray-700 text-sm font-medium">
            <span>中文</span>
            <img
              src="https://firebasestorage.googleapis.com/v0/b/egdi-ecosystem.appspot.com/o/eligibleNationalities%2Fchina.png?alt=media&token=094e6a2b-6af6-430d-9f51-5c74b70882e8"
              alt="Chinese"
              className="w-5 h-5 rounded-full object-cover" />

          </div>
          <div className="h-4 w-px bg-gray-300"></div>
          <button className="text-gray-500 hover:text-gray-700">
            <Grid3x3 className="w-5 h-5" />
          </button>
          <button className="text-gray-500 hover:text-gray-700 relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
          </button>
          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden">
            <User className="w-5 h-5 text-gray-500" />
          </div>
        </div>
      </header>

      {/* Sub-Header */}
      <div className="h-16 bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0 sticky top-16 z-40">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">

            <X className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">新投诉</h1>
        </div>
        <button className="px-6 py-2 bg-[#6B7280] hover:bg-[#4B5563] text-white font-medium rounded text-sm transition-colors">
          发送反馈
        </button>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto py-8 px-4">
        <div className="max-w-[800px] mx-auto bg-white rounded-lg shadow-sm p-10 md:p-12">
          {/* Form Header */}
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">投诉详情</h2>
            <p className="text-gray-600 text-sm leading-relaxed">
              我们会优先考虑您的反馈和疑虑。
              <br />
              请在下面的表格中填写您的请求或评论，然后单击"提交"。
            </p>
          </div>

          {/* Section 1: Comments */}
          <div className="mb-10">
            <h3 className="text-lg font-bold text-gray-900 mb-6">1.评论</h3>

            {/* Complaint Type */}
            <div className="mb-6 relative">
              <div className="relative">
                <select
                  className="w-full h-12 px-4 border border-gray-300 rounded appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-500"
                  defaultValue="">

                  <option value="" disabled>
                    选择评论类型*
                  </option>
                  <option value="service">服务态度</option>
                  <option value="process">办理流程</option>
                  <option value="system">系统问题</option>
                  <option value="other">其他</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Rich Text Editor */}
            <div className="mb-6 border border-gray-300 rounded overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-1 p-2 border-b border-gray-300 bg-white">
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <Bold className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <Italic className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <Underline className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <Strikethrough className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-gray-300 mx-1"></div>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <List className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <ListOrdered className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-gray-300 mx-1"></div>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <Type className="w-4 h-4" />
                </button>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <div className="bg-gray-200 px-1 rounded text-xs font-bold">
                    A
                  </div>
                </button>
                <div className="w-px h-4 bg-gray-300 mx-1"></div>
                <button className="p-1.5 hover:bg-gray-100 rounded text-gray-600">
                  <AlignLeft className="w-4 h-4" />
                </button>
              </div>
              {/* Text Area */}
              <div className="p-4 min-h-[160px] bg-white">
                <textarea
                  className="w-full h-full min-h-[160px] resize-none focus:outline-none text-gray-600 placeholder-gray-400 italic"
                  placeholder="投诉详情*">
                </textarea>
              </div>
            </div>

            {/* Attachment */}
            <div className="mb-2">
              <label className="block text-sm text-gray-700 mb-2">
                附件（如有）
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex items-center gap-4 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer">
                <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                  <Paperclip className="w-6 h-6 text-gray-500" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm mb-1">
                    插入附件
                  </h4>
                  <p className="text-xs text-gray-500">
                    附件可以是图片、视频或其他文件（大小不得超过100MB）。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Personal Info */}
          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-6">2.个人信息</h3>

            {/* Name Fields */}
            <div className="space-y-6 mb-6">
              <div className="relative">
                <input
                  type="text"
                  className="peer w-full h-12 px-4 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-transparent"
                  placeholder="姓"
                  id="lastName" />

                <label
                  htmlFor="lastName"
                  className="absolute left-4 top-3.5 text-gray-500 text-sm transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-blue-500 peer-focus:bg-white peer-focus:px-1 pointer-events-none bg-white px-1 -top-2.5 text-xs">

                  姓<span className="text-red-500">*</span>
                </label>
              </div>

              <div className="relative">
                <input
                  type="text"
                  className="peer w-full h-12 px-4 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-transparent"
                  placeholder="名"
                  id="firstName" />

                <label
                  htmlFor="firstName"
                  className="absolute left-4 top-3.5 text-gray-500 text-sm transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-blue-500 peer-focus:bg-white peer-focus:px-1 pointer-events-none bg-white px-1 -top-2.5 text-xs">

                  名<span className="text-red-500">*</span>
                </label>
              </div>
            </div>

            {/* Phone Number */}
            <div className="flex gap-4 mb-6">
              <div className="w-24 relative">
                <div className="absolute -top-2.5 left-2 bg-white px-1 text-xs text-gray-500 z-10">
                  电话号码<span className="text-red-500">*</span>
                </div>
                <div className="w-full h-12 px-4 border border-gray-300 rounded flex items-center text-gray-900 bg-white">
                  +855
                </div>
              </div>
              <div className="flex-1 relative">
                <input
                  type="tel"
                  className="peer w-full h-12 px-4 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-transparent"
                  placeholder="电话号码"
                  id="phone" />

                <label
                  htmlFor="phone"
                  className="absolute left-4 top-3.5 text-gray-500 text-sm transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-blue-500 peer-focus:bg-white peer-focus:px-1 pointer-events-none bg-white px-1 -top-2.5 text-xs">

                  电话号码<span className="text-red-500">*</span>
                </label>
              </div>
            </div>

            {/* Gender */}
            <div className="mb-6 relative">
              <div className="relative">
                <select
                  className="w-full h-12 px-4 border border-gray-300 rounded appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-500 pt-2"
                  defaultValue=""
                  id="gender">

                  <option value="" disabled></option>
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
                <label
                  htmlFor="gender"
                  className="absolute left-4 -top-2.5 text-xs text-gray-500 bg-white px-1 pointer-events-none">

                  性别<span className="text-red-500">*</span>
                </label>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Nationality */}
            <div className="mb-6 relative">
              <div className="relative">
                <input
                  type="text"
                  className="w-full h-12 px-4 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  defaultValue="Cambodian - ខ្មែរ"
                  readOnly />

                <label className="absolute left-4 -top-2.5 text-xs text-gray-500 bg-white px-1 pointer-events-none">
                  国籍<span className="text-red-500">*</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>);

}