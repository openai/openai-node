import React from 'react';
import { FileText, Smartphone, Briefcase, AlertTriangle, Plane, Phone, ArrowRight, UserPlus } from 'lucide-react';
import { useLanguage } from '../lib/LanguageContext';
export function ServiceCards() {
  const {
    t
  } = useLanguage();
  const services = [{
    title: t('service_visa_title'),
    description: t('service_visa_desc'),
    icon: FileText,
    link: '#'
  }, {
    title: t('service_smartgate_title'),
    description: t('service_smartgate_desc'),
    icon: Smartphone,
    link: '#'
  }, {
    title: t('service_work_title'),
    description: t('service_work_desc'),
    icon: Briefcase,
    link: '#'
  }, {
    title: t('service_citizenship_title'),
    description: t('service_citizenship_desc'),
    icon: UserPlus,
    link: '#'
  }, {
    title: t('service_advisory_title'),
    description: t('service_advisory_desc'),
    icon: AlertTriangle,
    link: '#'
  }, {
    title: t('service_arrival_title'),
    description: t('service_arrival_desc'),
    icon: Plane,
    link: '#'
  }, {
    title: t('service_contact_title'),
    description: t('service_contact_desc'),
    icon: Phone,
    link: '#'
  }];
  return <section className="py-16 md:py-24 bg-gray-50 relative">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-[#1B2A4A] mb-4">
            {t('services_title')}
          </h2>
          <div className="w-20 h-1 bg-[#D4841C] mx-auto mb-6"></div>
          <p className="text-gray-600 text-lg">{t('services_subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => <a key={index} href={service.link} className="group bg-white rounded-xl p-8 shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 hover:border-[#D4841C]/30 relative overflow-hidden">
              {/* Hover Accent */}
              <div className="absolute top-0 left-0 w-1 h-full bg-[#D4841C] transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300"></div>

              <div className="flex flex-col h-full">
                <div className="w-14 h-14 rounded-full bg-[#fdf8f1] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                  <service.icon className="w-7 h-7 text-[#D4841C]" />
                </div>

                <h3 className="text-xl font-bold text-[#1B2A4A] mb-3 group-hover:text-[#D4841C] transition-colors">
                  {service.title}
                </h3>

                <p className="text-gray-600 mb-6 flex-grow leading-relaxed">
                  {service.description}
                </p>

                <div className="flex items-center text-[#1B2A4A] font-medium text-sm group-hover:translate-x-2 transition-transform duration-300">
                  {t('access_service')}{' '}
                  <ArrowRight className="w-4 h-4 ml-2 text-[#D4841C]" />
                </div>
              </div>
            </a>)}
        </div>
      </div>
    </section>;
}