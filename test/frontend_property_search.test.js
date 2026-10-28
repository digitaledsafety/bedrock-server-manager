import { describe, it, expect, beforeEach } from '@jest/globals';

class MockElement {
    constructor(tagName, id = '', className = '') {
        this.tagName = tagName;
        this.id = id;
        this.className = className;
        this.classList = {
            _classes: new Set(className ? className.split(' ') : []),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            contains(c) { return this._classes.has(c); },
            toggle(c, force) {
                if (force !== undefined) {
                    if (force) this._classes.add(c);
                    else this._classes.delete(c);
                } else {
                    if (this._classes.has(c)) this._classes.delete(c);
                    else this._classes.add(c);
                }
            }
        };
        this.style = {};
        this.children = [];
        this.value = '';
        this.textContent = '';
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelector(selector) {
        if (selector === 'label') {
            return this.children.find(c => c.tagName === 'label') || null;
        }
        if (selector === '.tab-button.active') {
            return this.children.find(c => c.className.includes('tab-button') && c.classList.contains('active')) || null;
        }
        return null;
    }

    querySelectorAll(selector) {
        if (selector === '.form-group') {
            const results = [];
            const search = (node) => {
                for (const child of node.children) {
                    if (child.className.includes('form-group')) results.push(child);
                    search(child);
                }
            };
            search(this);
            return results;
        }
        if (selector === '.tab-content') {
            const results = [];
            const search = (node) => {
                for (const child of node.children) {
                    if (child.className.includes('tab-content')) results.push(child);
                    search(child);
                }
            };
            search(this);
            return results;
        }
        return [];
    }
}

describe('Frontend Property Search Filter', () => {
    let propertySearchInput;
    let propertiesContainer;
    let propertiesTabs;
    let tabContent1;
    let tabContent2;
    let group1;
    let group2;
    let propertyCategories;

    beforeEach(() => {
        propertySearchInput = new MockElement('input', 'propertySearch');
        propertiesContainer = new MockElement('div', 'propertiesContainer');
        propertiesTabs = new MockElement('div', 'propertiesTabs');

        tabContent1 = new MockElement('div', 'category-general', 'tab-content active');
        tabContent2 = new MockElement('div', 'category-advanced', 'tab-content');

        group1 = new MockElement('div', '', 'form-group');
        const label1 = new MockElement('label');
        label1.textContent = 'Server Name';
        group1.appendChild(label1);

        group2 = new MockElement('div', '', 'form-group');
        const label2 = new MockElement('label');
        label2.textContent = 'Max Players';
        group2.appendChild(label2);

        tabContent1.appendChild(group1);
        tabContent2.appendChild(group2);

        propertiesContainer.appendChild(tabContent1);
        propertiesContainer.appendChild(tabContent2);

        const tabButton1 = new MockElement('button', '', 'tab-button active');
        tabButton1.textContent = 'General';
        propertiesTabs.appendChild(tabButton1);

        propertyCategories = [
            { id: 'general', label: 'General' },
            { id: 'advanced', label: 'Advanced' }
        ];
    });

    const handleSearchInput = (query) => {
        propertySearchInput.value = query;
        const q = propertySearchInput.value.toLowerCase();
        const propertyGroups = propertiesContainer.querySelectorAll('.form-group');

        propertyGroups.forEach(group => {
            const labelEl = group.querySelector('label');
            const label = labelEl ? labelEl.textContent.toLowerCase() : '';
            if (label.includes(q)) {
                group.style.display = 'block';
            } else {
                group.style.display = 'none';
            }
        });

        if (q) {
            propertiesContainer.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = 'block';
                content.classList.add('active');
            });
            propertiesTabs.style.display = 'none';
        } else {
            propertiesContainer.querySelectorAll('.tab-content').forEach(content => {
                content.style.display = '';
            });
            propertyGroups.forEach(group => {
                group.style.display = '';
            });
            propertiesTabs.style.display = 'flex';
            const activeTabButton = propertiesTabs.querySelector('.tab-button.active');
            if (activeTabButton) {
                const categoryLabel = activeTabButton.textContent;
                const category = propertyCategories.find(c => c.label === categoryLabel);
                if (category) {
                    // switchTab simulation
                    propertiesTabs.children.forEach(btn => {
                        btn.classList.toggle('active', btn.textContent === category.label);
                    });
                    propertiesContainer.querySelectorAll('.tab-content').forEach(content => {
                        content.classList.toggle('active', content.id === `category-${category.id}`);
                    });
                }
            }
        }
    };

    it('should show matching property groups and display all tabs during search', () => {
        handleSearchInput('server');

        expect(group1.style.display).toBe('block');
        expect(group2.style.display).toBe('none');

        expect(tabContent1.style.display).toBe('block');
        expect(tabContent2.style.display).toBe('block');
        expect(propertiesTabs.style.display).toBe('none');
    });

    it('should reset inline display styles on tab contents and property groups when query is cleared', () => {
        handleSearchInput('server');
        handleSearchInput('');

        expect(group1.style.display).toBe('');
        expect(group2.style.display).toBe('');

        expect(tabContent1.style.display).toBe('');
        expect(tabContent2.style.display).toBe('');
        expect(propertiesTabs.style.display).toBe('flex');

        expect(tabContent1.classList.contains('active')).toBe(true);
        expect(tabContent2.classList.contains('active')).toBe(false);
    });
});
