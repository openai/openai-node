import React from 'react';
import { Calendar, ArrowRight, Tag } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
export function NewsSection() {
  const {
    t
  } = useLanguage();
  const news = [{
    id: 1,
    title: 'New Visa Regulations for 2024 Announced',
    date: 'October 15, 2023',
    category: 'Policy',
    excerpt: 'The General Department of Immigration has released updated guidelines for long-term visa extensions effective from January 1st.',
    image: 'bg-[#1B2A4A]/10'
  }, {
    id: 2,
    title: 'Smart Gate Expansion at Phnom Penh International Airport',
    date: 'September 28, 2023',
    category: 'Technology',
    excerpt: 'Ten additional automated border control gates have been installed to facilitate faster processing for eligible travelers.',
    image: 'bg-[#D4841C]/10'
  }, {
    id: 3,
    title: 'Department Launches New Online Service Portal',
    date: 'September 10, 2023',
    category: 'Service',
    excerpt: 'Citizens and foreigners can now access 15 different immigration services through the newly upgraded digital platform.',
    image: 'bg-gray-200'
  }];
  return <section className="py-16 md:py-24 bg-white border-t border-gray-100">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1B2A4A] mb-3">
              {t('news_title')}
            </h2>
            <p className="text-gray-600">{t('news_subtitle')}</p>
          </div>
          <a href="#" className="text-[#D4841C] font-semibold flex items-center hover:underline">
            {t('view_all_news')} <ArrowRight className="w-4 h-4 ml-2" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {news.map((item) => <article key={item.id} className="group flex flex-col h-full bg-white rounded-lg overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow duration-300">
              {/* Image Placeholder */}
              <div className={`h-48 w-full ${item.image} relative overflow-hidden`}>
                <div className="absolute inset-0 flex items-center justify-center text-[#1B2A4A]/20">
                  <span className="font-bold text-lg">News Image</span>
                </div>
                <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold text-[#1B2A4A] flex items-center gap-1 shadow-sm">
                  <Tag className="w-3 h-3 text-[#D4841C]" />
                  {item.category}
                </div>
              </div>

              <div className="p-6 flex flex-col flex-grow">
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                  <Calendar className="w-4 h-4 text-[#D4841C]" />
                  {item.date}
                </div>

                <h3 className="text-xl font-bold text-[#1B2A4A] mb-3 group-hover:text-[#D4841C] transition-colors line-clamp-2">
                  {item.title}
                </h3>

                <p className="text-gray-600 mb-6 line-clamp-3 text-sm leading-relaxed flex-grow">
                  {item.excerpt}
                </p>

                <a href="#" className="inline-flex items-center text-[#1B2A4A] font-semibold text-sm hover:text-[#D4841C] transition-colors mt-auto">
                  {t('read_full_article')}{' '}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </a>
              </div>
            </article>)}
        </div>
      </div>
    </section>;
}