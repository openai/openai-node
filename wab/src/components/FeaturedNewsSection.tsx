import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
export function FeaturedNewsSection() {
  const { t } = useLanguage();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const slides = [
  {
    id: 1,
    image: "/image.png",

    title:
    'ប្រជុំពិភាក្សាការងារពាក់ព័ន្ធប្រព័ន្ធម៉ែហានិភ័យអ្នកដំណើរតាមផ្លូវអាកាស GTAS',
    description:
    'ប្រជុំពិភាក្សាការងារពាក់ព័ន្ធប្រព័ន្ធម៉ែហានិភ័យអ្នកដំណើរតាមផ្លូវអាកាស GTAS',
    date: 'នៅព្រឹកថ្ងៃប្រហស្បតិ៍ ទី៨ ខែមករា ឆ្នាំ២០២៦ នេះ ឯកឧត្តម ឧត្តមសេនីយ៍ឯក សុខ វាសនា អគ្គនាយកអន្តោប្រវេសន៍...'
  },
  {
    id: 2,
    image: "/image-1.png",

    title:
    'កិច្ចប្រជុំតាមដានខ្មែរនភាពការងារបង្រ្គាបបទល្មើសជោគជ័យតាមប្រព័ន្ធបច្ចេកវិទ្យា...',
    description:
    'កិច្ចប្រជុំតាមដានខ្មែរនភាពការងារបង្រ្គាបបទល្មើសជោគជ័យតាមប្រព័ន្ធបច្ចេកវិទ្យា (Online Scams)',
    date: 'នៅព្រឹកថ្ងៃអង្គារ ទី៦ ខែមករា ឆ្នាំ២០២៦ នេះ ឯកឧត្តម ឧត្តមសេនីយ៍ឯក សុខ វាសនា អគ្គនាយកអន្តោប្រវេសន៍...'
  },
  {
    id: 3,
    image: "/image-2.png",

    title:
    'ពិធីបិទព្រឹត្តិការណ៍ប្រកួតកីឡាមហាបាដន់ ពានរង្វាន់ឯកឧត្តមអគ្គសេនីយ៍ឯក ស សុខា...',
    description:
    'ពិធីបិទព្រឹត្តិការណ៍ប្រកួតកីឡាមហាបាដន់ ពានរង្វាន់ឯកឧត្តមអគ្គសេនីយ៍ឯក ស សុខា ដើម្បីអបអរសាទរវិជ្ជមានមួយ ពាមករា',
    date: 'នៅសៀលថ្ងៃចន្ទ ទី៥ ខែមករា ឆ្នាំ២០២៦ នេះ ឯកឧត្តម ឧត្តមសេនីយ៍ឯក សុខ វាសនា អគ្គ...'
  },
  {
    id: 4,
    image: "/image-3.png",

    title:
    'វឌ្ឍនភាពការងារត្រួតពិនិត្យវត្តមានស្នាក់នៅរបស់ជនបរទេសនៅក្នុងព្រះរាជាណាចក្រ...',
    description:
    'វឌ្ឍនភាពការងារត្រួតពិនិត្យវត្តមានស្នាក់នៅរបស់ជនបរទេសនៅក្នុងព្រះរាជាណាចក្រកម្ពុជា',
    date: 'នៅព្រឹកថ្ងៃសុក្រ ទី៩ ខែមករា ឆ្នាំ២០២៦ នេះ ឯកឧត្តម ឧត្តមសេនីយ៍ឯក សុខ វាសនា អគ្គនាយកអន្តោប្រវេសន៍ ព្រមទាំង...'
  }];

  const goToSlide = useCallback(
    (index: number) => {
      if (isTransitioning) return;
      setIsTransitioning(true);
      setCurrentSlide(index);
      setTimeout(() => setIsTransitioning(false), 600);
    },
    [isTransitioning]
  );
  const nextSlide = useCallback(() => {
    goToSlide((currentSlide + 1) % slides.length);
  }, [currentSlide, slides.length, goToSlide]);
  const prevSlide = useCallback(() => {
    goToSlide((currentSlide - 1 + slides.length) % slides.length);
  }, [currentSlide, slides.length, goToSlide]);
  // Auto-rotate every 3 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      nextSlide();
    }, 3000);
    return () => clearInterval(timer);
  }, [nextSlide]);
  return (
    <section className="w-full bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <div className="flex flex-col lg:flex-row gap-6 h-auto lg:h-[500px]">
          {/* Left Column: News Carousel */}
          <div className="w-full lg:w-[65%] relative rounded-xl overflow-hidden shadow-lg group h-[350px] lg:h-full">
            {/* All slides stacked, only current one visible */}
            {slides.map((slide, idx) =>
            <div
              key={slide.id}
              className="absolute inset-0 bg-cover bg-center transition-opacity duration-600 ease-in-out"
              style={{
                backgroundImage: `url(${slide.image})`,
                opacity: currentSlide === idx ? 1 : 0,
                zIndex: currentSlide === idx ? 1 : 0,
                transitionDuration: '600ms'
              }}>

                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
              </div>
            )}

            {/* Content Overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 text-white z-10">
              <h2
                className="text-2xl md:text-3xl lg:text-4xl font-bold mb-3 leading-tight font-khmer-title transition-all duration-500"
                key={`title-${currentSlide}`}>

                {slides[currentSlide].title}
              </h2>
              <p className="text-sm md:text-base text-gray-200 mb-2 font-khmer line-clamp-2">
                {slides[currentSlide].description}
              </p>
              <p className="text-xs md:text-sm text-gray-400 font-khmer line-clamp-2">
                {slides[currentSlide].date}
              </p>
            </div>

            {/* Navigation Arrows */}
            <button
              onClick={prevSlide}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center text-white transition-all z-20">

              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={nextSlide}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/40 hover:bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center text-white transition-all z-20">

              <ChevronRight className="w-6 h-6" />
            </button>

            {/* Pagination Dots */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
              {slides.map((_, idx) =>
              <button
                key={idx}
                onClick={() => goToSlide(idx)}
                className={`h-2.5 rounded-full transition-all duration-300 ${currentSlide === idx ? 'bg-white w-8' : 'bg-white/40 w-2.5 hover:bg-white/70'}`} />

              )}
            </div>

            {/* Progress Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 z-20">
              <div
                className="h-full bg-[#F57C20] transition-all ease-linear"
                style={{
                  width: `${(currentSlide + 1) / slides.length * 100}%`,
                  transitionDuration: '300ms'
                }} />

            </div>
          </div>

          {/* Right Column: Profile Card */}
          <div className="w-full lg:w-[35%] bg-white rounded-xl shadow-lg overflow-hidden flex flex-col relative">
            {/* Orange Header Curve */}
            <div
              className="absolute top-0 left-0 right-0 h-32 bg-[#F57C20]"
              style={{
                clipPath: 'ellipse(80% 100% at 50% 0%)'
              }}>
            </div>

            {/* Profile Image */}
            <div className="relative z-10 flex justify-center mt-8 mb-4">
              <div className="w-40 h-48 bg-gray-200 rounded-lg overflow-hidden border-4 border-white shadow-md">
                <img
                  src="/image-4.png"
                  alt="Director General"
                  className="w-full h-full object-cover object-top" />

              </div>
            </div>

            {/* Text Content */}
            <div className="px-6 pb-8 text-center flex-grow flex flex-col items-center">
              <h3 className="text-lg font-bold text-[#F57C20] mb-1 font-khmer-title">
                សារស្វាគមន៍របស់ឯកឧត្តម
              </h3>
              <h4 className="text-base font-bold text-[#1B2A4A] mb-4 font-khmer-title">
                ឯកឧត្តម ឧត្តមសេនីយ៍ឯក សុខ វាសនា
              </h4>

              <p className="text-gray-600 text-sm mb-6 font-khmer leading-relaxed line-clamp-4">
                សូមស្វាគមន៍ចំពោះការចូលទស្សនាគេហទំព័រអគ្គនាយកដ្ឋាន អន្តោប្រវេសន៍!
                អ្នកអានជាទីគោរ! ដើម្បីឆ្លើតទៅសម្រេចបានកម្មវត្ថុស័យឆ្នាំ២០៤០
                ដែលកម្ពុជាជាយផ្សេទមានចំណុលខ្ពស់ រជ្ជកាលបានដាក់ចេញនូវក្រុម
                ខណ្ឌនយោបាយ យុទ្ធសាស្រ្តបញ្ញាពេលណ ដំណាក់កាលទី១...
              </p>

              <a
                href="/leader_remark/RMNalbCT1GmTLcBJA7W6"
                className="mt-auto px-8 py-2.5 border-2 border-[#F57C20] text-[#F57C20] font-bold rounded-lg hover:bg-[#F57C20] hover:text-white transition-all duration-300 w-full max-w-[200px] text-center inline-block">

                Read More
              </a>
            </div>

            {/* Background Pattern (Subtle) */}
            <div
              className="absolute inset-0 opacity-[0.03] pointer-events-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
              }}>
            </div>
          </div>
        </div>
      </div>

      {/* Orange Announcement Banner - Ticker */}
      <div
        className="w-full mt-6"
        style={{
          background: 'linear-gradient(to right, #E53030, #F57C20)'
        }}>

        <div className="container mx-auto px-4 py-3 flex items-center gap-3 overflow-hidden">
          {/* Label Tag */}
          <span
            className="shrink-0 text-white text-xs md:text-sm font-bold px-3 py-1 rounded"
            style={{
              background: 'linear-gradient(135deg, #cc0000, #E53030)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}>

            ព័ត៌មានថ្មី
          </span>

          {/* Scrolling Ticker */}
          <div className="overflow-hidden flex-1 relative">
            <div
              className="whitespace-nowrap inline-block"
              style={{
                animation: 'marquee 30s linear infinite'
              }}>

              <span className="text-white text-sm md:text-base font-medium">
                នៅក្នុងឆ្នាំ២០២៦ចាប់ពីខែកុម្ភះនេះទៅថ្នាក់ដឹងនាំនៃព្រះរាជាណាចក្រកម្ពុជាបានចេញសេចក្តីថ្លែងការណ័នឹងជំរាប់ដល់ជនជាតិបរទេសទាំងអស់ដែលរស់នៅកម្ពុជា
                ដែលមានប្រវត្តរស់នៅកម្ពុជា២ឆ្នាំឡើងនិងមានសិទ្ធិស្នើរសុំចូលជាសញ្ជាត្តិកម្ពុជា
                ៕ ពត៏មានបន្ថែមអាចទំនាក់ទំនងមកកាន់គេហទំព័រផ្លូវការរបស់
                អគ្គនាយកដ្ឋានអន្តោប្រវេសន៍ ។
              </span>
              <span className="text-white text-sm md:text-base font-medium ml-24">
                នៅក្នុងឆ្នាំ២០២៦ចាប់ពីខែកុម្ភះនេះទៅថ្នាក់ដឹងនាំនៃព្រះរាជាណាចក្រកម្ពុជាបានចេញសេចក្តីថ្លែងការណ័នឹងជំរាប់ដល់ជនជាតិបរទេសទាំងអស់ដែលរស់នៅកម្ពុជា
                ដែលមានប្រវត្តរស់នៅកម្ពុជា២ឆ្នាំឡើងនិងមានសិទ្ធិស្នើរសុំចូលជាសញ្ជាត្តិកម្ពុជា
                ៕ ពត៏មានបន្ថែមអាចទំនាក់ទំនងមកកាន់គេហទំព័រផ្លូវការរបស់
                អគ្គនាយកដ្ឋានអន្តោប្រវេសន៍ ។
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>);

}