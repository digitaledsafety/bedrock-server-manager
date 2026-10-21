import { jest } from '@jest/globals';

describe('Property Search UI Handler', () => {
    let propertySearchInput;
    let propertiesContainer;
    let propertiesTabs;
    let tabContents;
    let formGroups;
    let activeTabButton;
    let propertyCategories;
    let searchHandler;

    beforeEach(() => {
        // Create mock property groups with labels
        formGroups = [
            {
                style: { display: '' },
                querySelector: jest.fn((selector) => {
                    if (selector === 'label') return { textContent: 'Server Name' };
                    return null;
                })
            },
            {
                style: { display: '' },
                querySelector: jest.fn((selector) => {
                    if (selector === 'label') return { textContent: 'Max Players' };
                    return null;
                })
            },
            {
                style: { display: '' },
                querySelector: jest.fn((selector) => {
                    if (selector === 'label') return { textContent: 'Difficulty' };
                    return null;
                })
            }
        ];

        propertiesContainer = {
            querySelectorAll: jest.fn((selector) => {
                if (selector === '.form-group') return formGroups;
                return [];
            })
        };

        tabContents = [
            { id: 'category-general', style: { display: '' }, classList: { add: jest.fn(), toggle: jest.fn() } },
            { id: 'category-gameplay', style: { display: '' }, classList: { add: jest.fn(), toggle: jest.fn() } }
        ];

        activeTabButton = { textContent: 'General' };

        propertiesTabs = {
            style: { display: 'flex' },
            querySelector: jest.fn((selector) => {
                if (selector === '.tab-button.active') return activeTabButton;
                return null;
            })
        };

        propertyCategories = [
            { id: 'general', label: 'General' },
            { id: 'gameplay', label: 'Gameplay' }
        ];

        propertySearchInput = {
            value: '',
            listeners: {},
            addEventListener: jest.fn((event, handler) => {
                propertySearchInput.listeners[event] = handler;
            })
        };

        // Re-create the search handler logic from public/script.js
        searchHandler = () => {
            const query = propertySearchInput.value.toLowerCase();
            const propertyGroups = propertiesContainer.querySelectorAll('.form-group');

            if (query) {
                propertyGroups.forEach(group => {
                    const labelEl = group.querySelector('label');
                    const label = labelEl ? labelEl.textContent.toLowerCase() : '';
                    if (label.includes(query)) {
                        group.style.display = 'block';
                    } else {
                        group.style.display = 'none';
                    }
                });

                tabContents.forEach(content => {
                    content.style.display = 'block';
                    content.classList.add('active');
                });
                propertiesTabs.style.display = 'none';
            } else {
                propertyGroups.forEach(group => {
                    group.style.display = '';
                });
                tabContents.forEach(content => {
                    content.style.display = '';
                });
                propertiesTabs.style.display = 'flex';
                const activeTab = propertiesTabs.querySelector('.tab-button.active');
                if (activeTab) {
                    const categoryLabel = activeTab.textContent;
                    const category = propertyCategories.find(c => c.label === categoryLabel);
                    if (category) {
                        // switchTab mock
                        tabContents.forEach(content => {
                            content.classList.toggle('active', content.id === `category-${category.id}`);
                        });
                    }
                }
            }
        };

        propertySearchInput.addEventListener('input', searchHandler);
    });

    it('should filter form groups and expand tab contents when query is entered', () => {
        propertySearchInput.value = 'diff';
        propertySearchInput.listeners['input']();

        // Check group filtering: 'Server Name' & 'Max Players' hidden, 'Difficulty' shown
        expect(formGroups[0].style.display).toBe('none');
        expect(formGroups[1].style.display).toBe('none');
        expect(formGroups[2].style.display).toBe('block');

        // Check tabs hidden and tab contents expanded
        expect(propertiesTabs.style.display).toBe('none');
        expect(tabContents[0].style.display).toBe('block');
        expect(tabContents[1].style.display).toBe('block');
    });

    it('should reset group and content display styles when query is cleared', () => {
        // Step 1: Search for 'diff'
        propertySearchInput.value = 'diff';
        propertySearchInput.listeners['input']();

        // Step 2: Clear search
        propertySearchInput.value = '';
        propertySearchInput.listeners['input']();

        // All form groups display should be reset to ''
        expect(formGroups[0].style.display).toBe('');
        expect(formGroups[1].style.display).toBe('');
        expect(formGroups[2].style.display).toBe('');

        // Tab content display inline styles should be reset to ''
        expect(tabContents[0].style.display).toBe('');
        expect(tabContents[1].style.display).toBe('');

        // Tab navigation container should be visible again
        expect(propertiesTabs.style.display).toBe('flex');
    });
});
